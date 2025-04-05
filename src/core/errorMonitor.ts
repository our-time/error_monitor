import type { App, ComponentPublicInstance } from 'vue'
import type { ReportService } from '../services/reportService'
import type { SourceMapService } from '../services/sourceMapService'
import type { ErrorConfig } from '../types/config'
import { generateErrorId, getErrorInfo } from '../utils/errorUtils'

declare global {
  interface XMLHttpRequest {
    _url?: string
    _method?: string
  }
}

interface ErrorContext {
  type?: string
  [key: string]: any
}

export class ErrorMonitor {
  private app: App
  private reportService: ReportService
  private sourceMapService: SourceMapService
  private config: ErrorConfig
  private errorCount = new Map<string, number>()
  private errorCountResetInterval: number
  private originalErrorHandler?: (err: unknown, instance: ComponentPublicInstance | null, info: string) => void
  private originalPromiseHandler?: (event: PromiseRejectionEvent) => void

  constructor(app: App, reportService: ReportService, sourceMapService: SourceMapService, config: ErrorConfig) {
    this.app = app
    this.reportService = reportService
    this.sourceMapService = sourceMapService
    this.config = config
    this.errorCountResetInterval = window.setInterval(() => this.errorCount.clear(), 60000)
    this.originalErrorHandler = app.config.errorHandler
    this.originalPromiseHandler = window.onunhandledrejection || undefined

    this.init()
  }

  private init(): void {
    if (this.config.captureGlobalErrors) this.setupGlobalErrorHandler()
    if (this.config.capturePromiseErrors) this.setupPromiseErrorHandler()
    if (this.config.captureAjaxErrors) this.setupAjaxErrorHandler()
    if (this.config.captureResourceErrors) this.setupResourceErrorHandler()
  }

  private setupGlobalErrorHandler(): void {
    this.app.config.errorHandler = (err, instance, info) => {
      this.handleComponentError(err as Error, instance, info)
      this.originalErrorHandler?.(err, instance, info)
    }

    window.addEventListener('error', this.handleWindowError.bind(this), true)
  }

  private handleWindowError(event: ErrorEvent): boolean {
    if (event.error && !this.isResourceError(event)) {
      this.handleJsError(event.error, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        message: event.message,
        type: ''
      })
    }
    return true
  }

  private setupPromiseErrorHandler(): void {
    window.onunhandledrejection = (event: PromiseRejectionEvent) => {
      const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason))
      this.handleJsError(error, {
        type: 'unhandledrejection',
        message: String(event.reason)
      })
      this.originalPromiseHandler?.(event)
    }
  }

  private setupAjaxErrorHandler(): void {
    const originalXhrOpen = XMLHttpRequest.prototype.open
    const originalXhrSend = XMLHttpRequest.prototype.send
    const originalFetch = window.fetch
    const self = this // Store reference to this instance

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string,
      async = true,
      username?: string | null,
      password?: string | null
    ) {
      this._url = url
      this._method = method
      return originalXhrOpen.call(this, method, url, async as boolean, username, password)
    }

    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('error', () => {
        self.handleNetworkError(new Error(`XHR Error: ${this._url}`), {
          url: this._url,
          method: this._method,
          status: this.status,
          statusText: this.statusText
        })
      })

      this.addEventListener('timeout', () => {
        self.handleNetworkError(new Error(`XHR Timeout: ${this._url}`), {
          url: this._url,
          method: this._method,
          timeout: this.timeout
        })
      })

      return originalXhrSend.apply(this, args)
    }

    window.fetch = async (...args) => {
      try {
        return await originalFetch(...args)
      } catch (error) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url
        const method = args[1]?.method || 'GET'
        this.handleNetworkError(error as Error, {
          url,
          method
        })
        throw error
      }
    }
  }

  private setupResourceErrorHandler(): void {
    window.addEventListener('error', this.handleResourceErrorEvent.bind(this), true)
  }

  // Renamed from handleResourceError to handleResourceErrorEvent to avoid confusion
  private handleResourceErrorEvent(event: ErrorEvent): boolean {
    if (this.isResourceError(event)) {
      const target = event.target as HTMLElement
      this.reportResourceError(new Error(`Failed to load ${target.tagName}`), {
        tagName: target.tagName.toLowerCase(),
        src: (target as HTMLImageElement | HTMLScriptElement).src || (target as HTMLLinkElement).href,
        type: target.getAttribute('type'),
        id: target.id,
        className: target.className
      })
    }
    return true
  }

  // New method to handle resource errors
  private reportResourceError(error: Error, context: any): void {
    if (this.shouldIgnoreError(error)) return
    if (this.isRateLimited(error)) return
    this.processAndReportError(error, { type: 'resource_error', ...context })
  }

  private isResourceError(event: ErrorEvent): boolean {
    const target = event.target as HTMLElement
    return target instanceof HTMLElement && ['IMG', 'SCRIPT', 'LINK', 'AUDIO', 'VIDEO'].includes(target.tagName)
  }

  public handleJsError(error: Error, context: ErrorContext = {}): void {
    if (this.shouldIgnoreError(error)) return
    if (this.isRateLimited(error)) return
    this.processAndReportError(error, { type: 'js_error', ...context })
  }

  public handleComponentError(error: Error, instance: ComponentPublicInstance | null, info: string): void {
    if (this.shouldIgnoreError(error)) return
    if (this.isRateLimited(error)) return

    const componentName = instance?.$options.name || 'AnonymousComponent'
    this.processAndReportError(error, {
      type: 'vue_error',
      componentName,
      lifecycleHook: info,
      componentData: instance ? this.sanitizeComponentData(instance.$data) : null
    })
  }

  private handleNetworkError(error: Error, context: ErrorContext = {}): void {
    if (this.shouldIgnoreError(error)) return
    if (this.isRateLimited(error)) return
    this.processAndReportError(error, { type: 'network_error', ...context })
  }

  private async processAndReportError(error: Error, context: ErrorContext): Promise<void> {
    const errorInfo = getErrorInfo(error)
    const errorId = generateErrorId(errorInfo)

    let stackFrames = errorInfo.stack
    if (this.sourceMapService.isEnabled()) {
      try {
        stackFrames = await this.sourceMapService.mapStackTrace(errorInfo.stack)
      } catch (e) {
        console.error('Failed to map stack trace:', e)
      }
    }

    this.reportService.reportError({
      errorId,
      message: errorInfo.message,
      stack: stackFrames,
      type: context.type || 'unknown',
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      context
    })
  }

  private shouldIgnoreError(error: Error): boolean {
    if (!error) return true
    const message = error.message || ''
    return (this.config.ignoreErrors || []).some(pattern =>
      pattern instanceof RegExp ? pattern.test(message) : message.includes(pattern)
    )
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
      const seen = new WeakSet()
      return JSON.parse(
        JSON.stringify(data, (_, value) => {
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[Circular]'
            seen.add(value)
          }
          return value
        })
      )
    } catch {
      return Object.keys(data).reduce(
        (acc, key) => {
          acc[key] = typeof data[key] === 'object' ? '[Complex Object]' : data[key]
          return acc
        },
        {} as Record<string, any>
      )
    }
  }

  public destroy(): void {
    clearInterval(this.errorCountResetInterval)
    window.removeEventListener('error', this.handleWindowError, true)
    window.removeEventListener('error', this.handleResourceErrorEvent, true) // Fixed method name
    this.app.config.errorHandler = this.originalErrorHandler
    window.onunhandledrejection = this.originalPromiseHandler || null
  }
}
