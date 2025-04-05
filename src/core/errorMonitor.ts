import { App, ComponentPublicInstance } from 'vue'
import { ReportService } from '../services/reportService'
import { SourceMapService } from '../services/sourceMapService'
import { ErrorConfig } from '../types/config'
import { generateErrorId, getErrorInfo } from '../utils/errorUtils'

declare global {
  interface XMLHttpRequest {
    _url?: string
    _method?: string
  }
}

export class ErrorMonitor {
  private app: App
  private reportService: ReportService
  private sourceMapService: SourceMapService
  private config: ErrorConfig
  private errorCount: Map<string, number> = new Map()
  private errorCountResetInterval: number

  constructor(app: App, reportService: ReportService, sourceMapService: SourceMapService, config: ErrorConfig) {
    this.app = app
    this.reportService = reportService
    this.sourceMapService = sourceMapService
    this.config = config

    // 每分钟重置错误计数
    this.errorCountResetInterval = window.setInterval(() => {
      this.errorCount.clear()
    }, 60000)

    this.app.config.globalProperties.$errorMonitor = this

    this.init()
  }

  private init(): void {
    if (this.config.captureGlobalErrors) {
      this.setupGlobalErrorHandler()
    }

    if (this.config.capturePromiseErrors) {
      this.setupPromiseErrorHandler()
    }

    if (this.config.captureAjaxErrors) {
      this.setupAjaxErrorHandler()
    }

    if (this.config.captureResourceErrors) {
      this.setupResourceErrorHandler()
    }
  }

  private setupGlobalErrorHandler(): void {
    window.addEventListener(
      'error',
      event => {
        // 忽略资源加载错误，这些由 setupResourceErrorHandler 处理
        if (event.error && !this.isResourceError(event)) {
          this.handleJsError(event.error, {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            message: event.message
          })
        }
        return true // 不阻止默认处理
      },
      true
    )
  }

  private setupPromiseErrorHandler(): void {
    window.addEventListener('unhandledrejection', event => {
      const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason))

      this.handleJsError(error, {
        type: 'unhandledrejection',
        message: String(event.reason)
      })
    })
  }

  private setupAjaxErrorHandler(): void {
    const originalXhrOpen = XMLHttpRequest.prototype.open
    const originalXhrSend = XMLHttpRequest.prototype.send
    const originalFetch = window.fetch
    const self = this

    // 拦截 XMLHttpRequest
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string,
      async: boolean = true,
      username?: string | null,
      password?: string | null
    ) {
      this._url = url
      this._method = method
      return originalXhrOpen.apply(this, [method, url, async, username, password])
    }

    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('error', function () {
        self.handleNetworkError(new Error(`XHR Error: ${this._url}`), {
          url: this._url,
          method: this._method,
          status: this.status,
          statusText: this.statusText
        })
      })

      this.addEventListener('timeout', function () {
        self.handleNetworkError(new Error(`XHR Timeout: ${this._url}`), {
          url: this._url,
          method: this._method,
          timeout: this.timeout
        })
      })

      return originalXhrSend.apply(this, args)
    }

    // 拦截 Fetch
    window.fetch = function (...args) {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url
      const method = args[1]?.method || 'GET'

      return originalFetch.apply(window, args).catch(error => {
        self.handleNetworkError(error, {
          url,
          method
        })
        throw error
      })
    }
  }

  private setupResourceErrorHandler(): void {
    window.addEventListener(
      'error',
      event => {
        if (this.isResourceError(event)) {
          const target = event.target as HTMLElement
          const tagName = target.tagName.toLowerCase()

          this.handleResourceError(new Error(`Failed to load ${tagName}`), {
            tagName,
            src: (target as HTMLImageElement | HTMLScriptElement).src || (target as HTMLLinkElement).href,
            type: target.getAttribute('type'),
            id: target.id,
            className: target.className
          })
        }
        return true
      },
      true
    )
  }

  private isResourceError(event: ErrorEvent): boolean {
    const target = event.target as HTMLElement
    return (
      target instanceof HTMLElement &&
      (target.tagName === 'IMG' ||
        target.tagName === 'SCRIPT' ||
        target.tagName === 'LINK' ||
        target.tagName === 'AUDIO' ||
        target.tagName === 'VIDEO')
    )
  }

  public handleJsError(error: Error, context: Record<string, any> = {}): void {
    if (this.shouldIgnoreError(error)) {
      return
    }

    if (this.isRateLimited(error)) {
      return
    }

    this.processAndReportError(error, {
      type: 'js_error',
      ...context
    })
  }

  public handleComponentError(error: Error, instance: ComponentPublicInstance | null, info: string): void {
    if (this.shouldIgnoreError(error)) {
      return
    }

    if (this.isRateLimited(error)) {
      return
    }

    const componentName = instance ? instance.$options.name || 'AnonymousComponent' : 'Unknown'

    this.processAndReportError(error, {
      type: 'vue_error',
      componentName,
      lifecycleHook: info,
      componentData: instance ? this.sanitizeComponentData(instance.$data) : null
    })
  }

  private handleNetworkError(error: Error, context: Record<string, any> = {}): void {
    if (this.shouldIgnoreError(error)) {
      return
    }

    if (this.isRateLimited(error)) {
      return
    }

    this.processAndReportError(error, {
      type: 'network_error',
      ...context
    })
  }

  private handleResourceError(error: Error, context: Record<string, any> = {}): void {
    if (this.shouldIgnoreError(error)) {
      return
    }

    if (this.isRateLimited(error)) {
      return
    }

    this.processAndReportError(error, {
      type: 'resource_error',
      ...context
    })
  }

  private async processAndReportError(error: Error, context: Record<string, any> = {}): Promise<void> {
    const errorInfo = getErrorInfo(error)
    const errorId = generateErrorId(errorInfo)

    // 使用 SourceMap 服务解析错误堆栈
    let stackFrames = errorInfo.stack
    if (this.sourceMapService.isEnabled()) {
      try {
        stackFrames = await this.sourceMapService.mapStackTrace(errorInfo.stack)
      } catch (e) {
        console.error('Failed to map stack trace:', e)
      }
    }

    const reportData = {
      errorId,
      message: errorInfo.message,
      stack: stackFrames,
      type: context.type || 'unknown',
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      context
    }

    this.reportService.reportError(reportData)
  }

  private shouldIgnoreError(error: Error): boolean {
    if (!error) return true

    const message = error.message || ''

    return (this.config.ignoreErrors || []).some(pattern => {
      if (pattern instanceof RegExp) {
        return pattern.test(message)
      }
      return message.includes(pattern)
    })
  }

  private isRateLimited(error: Error): boolean {
    const errorId = generateErrorId(getErrorInfo(error))
    const count = (this.errorCount.get(errorId) || 0) + 1
    this.errorCount.set(errorId, count)

    return count > this.config.maxErrorsPerMinute
  }

  private sanitizeComponentData(data: any): any {
    if (!data) return null

    try {
      // 简单的深拷贝，移除可能的循环引用
      return JSON.parse(JSON.stringify(data))
    } catch (e) {
      // 如果数据无法序列化，返回简化版本
      return Object.keys(data).reduce(
        (acc, key) => {
          const value = data[key]
          acc[key] = typeof value === 'object' ? '[Complex Object]' : value
          return acc
        },
        {} as Record<string, any>
      )
    }
  }

  public destroy(): void {
    clearInterval(this.errorCountResetInterval)
    // 清理其他可能的事件监听器
  }
}
