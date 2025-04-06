import { ReportConfig } from '../types/config'

interface ReportItem {
  id: string
  data: any
  timestamp: number
  retryCount: number
}

export class ReportService {
  private config: ReportConfig
  private queue: ReportItem[] = []
  private sending: boolean = false
  private batchInterval: number | null = null
  private offlineQueue: ReportItem[] = []
  private isOnline: boolean = navigator.onLine

  constructor(config: ReportConfig) {
    this.config = config
    this.init()
  }

  private init(): void {
    // 设置批量上报定时器
    if (this.config.batchReport) {
      this.batchInterval = window.setInterval(() => {
        this.processBatch()
      }, this.config.batchInterval)
    }

    // 监听网络状态变化
    window.addEventListener('online', this.handleOnline.bind(this))
    window.addEventListener('offline', this.handleOffline.bind(this))

    // 页面卸载前尝试发送所有数据
    window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this))
  }

  public reportError(data: any): void {
    // 采样率过滤
    if (Math.random() > (this.config.sampleRate || 1)) {
      return
    }

    // 根据日志级别过滤
    if (this.config.reportLevel === 'error' && data.level !== 'error') {
      return
    }

    const reportItem: ReportItem = {
      id: this.generateId(),
      data: {
        ...data,
        appId: this.config.appId,
        appVersion: this.config.appVersion,
        environment: this.config.environment,
        category: 'error'
      },
      timestamp: Date.now(),
      retryCount: 0
    }

    // 前置处理钩子
    if (this.config.beforeReport) {
      const processedData = this.config.beforeReport(reportItem.data)
      if (processedData === false) {
        return // 被钩子函数拦截
      }
      if (processedData) {
        reportItem.data = processedData
      }
    }

    // 集成第三方服务
    this.sendToIntegrations(reportItem.data)

    // 添加到队列
    if (this.config.batchReport) {
      this.queue.push(reportItem)

      // 如果队列达到批处理大小，立即处理
      if (this.queue.length >= this.config.batchSize) {
        this.processBatch()
      }
    } else {
      this.sendReport(reportItem)
    }
  }

  public reportPerformance(data: any): void {
    // 采样率过滤
    if (Math.random() > (this.config.sampleRate || 1)) {
      return
    }

    const reportItem: ReportItem = {
      id: this.generateId(),
      data: {
        ...data,
        appId: this.config.appId,
        appVersion: this.config.appVersion,
        environment: this.config.environment,
        category: 'performance'
      },
      timestamp: Date.now(),
      retryCount: 0
    }

    // 前置处理钩子
    if (this.config.beforeReport) {
      const processedData = this.config.beforeReport(reportItem.data)
      if (processedData === false) {
        return // 被钩子函数拦截
      }
      if (processedData) {
        reportItem.data = processedData
      }
    }

    // 添加到队列
    if (this.config.batchReport) {
      this.queue.push(reportItem)
    } else {
      this.sendReport(reportItem)
    }
  }

  private processBatch(): void {
    if (this.sending || this.queue.length === 0) {
      return
    }

    this.sending = true

    // 取出当前批次的数据
    const batch = this.queue.splice(0, this.config.batchSize)

    // 如果离线，添加到离线队列
    if (!this.isOnline) {
      this.offlineQueue.push(...batch)
      this.sending = false
      return
    }

    // 发送批量数据
    this.sendBatchReport(batch)
      .catch(() => {
        // 发送失败，重新加入队列等待重试
        batch.forEach(item => {
          item.retryCount++
          if (item.retryCount <= this.config.maxRetryCount) {
            this.queue.unshift(item)
          }
        })
      })
      .finally(() => {
        this.sending = false

        // 如果队列中还有数据，继续处理
        if (this.queue.length > 0) {
          setTimeout(() => this.processBatch(), 0)
        }
      })
  }

  private async sendBatchReport(batch: ReportItem[]): Promise<void> {
    // 检查 endpoint 是否有效
    if (!this.config.endpoint || this.config.endpoint === '') {
      if (this.config.debug) {
        console.warn('Report endpoint is not configured, skipping batch report')
      }
      return
    }

    try {
      // Log the endpoint being used (helpful for debugging)
      if (this.config.debug) {
        console.log(`Sending batch report to: ${this.config.endpoint}`, {
          batchSize: batch.length,
          firstItem: batch[0]?.data
        })
      }

      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers
        },
        body: JSON.stringify({
          batch: batch.map(item => item.data),
          timestamp: Date.now()
        }),
        // 在页面卸载时使用 keepalive
        keepalive: true
      })

      if (!response.ok) {
        // Enhanced error message with more details
        const errorText = await response.text().catch(() => 'No response text')
        throw new Error(`HTTP error! status: ${response.status}, url: ${this.config.endpoint}, response: ${errorText}`)
      }

      // Log success if debug mode is enabled
      if (this.config.debug) {
        console.log(`Successfully sent batch of ${batch.length} items`)
      }
    } catch (error) {
      console.error('Error sending batch report:', error)

      // Check if the endpoint is configured
      if (!this.config.endpoint || this.config.endpoint === '') {
        console.error('Error: Report endpoint is not configured properly')
      }

      throw error
    }
  }

  private async sendReport(item: ReportItem): Promise<void> {
    // 如果离线，添加到离线队列
    if (!this.isOnline) {
      this.offlineQueue.push(item)
      return
    }

    // 检查 endpoint 是否有效
    if (!this.config.endpoint || this.config.endpoint === '') {
      if (this.config.debug) {
        console.warn('Report endpoint is not configured, skipping report')
      }
      return
    }

    try {
      // Debug logging
      if (this.config.debug) {
        console.log(`Sending report to: ${this.config.endpoint}`, {
          itemId: item.id,
          category: item.data.category
        })
      }

      // 尝试使用 Beacon API (适用于页面卸载时)
      if (this.config.useBeacon && navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(item.data)], {
          type: 'application/json'
        })
        const success = navigator.sendBeacon(this.config.endpoint, blob)

        if (success) {
          if (this.config.debug) {
            console.log('Successfully sent report using Beacon API')
          }
          return
        }
      }

      // 回退到 fetch
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers
        },
        body: JSON.stringify(item.data),
        // 在页面卸载时使用 keepalive
        keepalive: true
      })

      if (!response.ok) {
        // Enhanced error message with more details
        const errorText = await response.text().catch(() => 'No response text')
        throw new Error(`HTTP error! status: ${response.status}, url: ${this.config.endpoint}, response: ${errorText}`)
      }

      if (this.config.debug) {
        console.log('Successfully sent report using fetch')
      }
    } catch (error) {
      console.error('Error sending report:', error)

      // Check if the endpoint is configured
      if (!this.config.endpoint || this.config.endpoint === '') {
        console.error('Error: Report endpoint is not configured properly')
      }

      // 重试逻辑
      item.retryCount++
      if (item.retryCount <= this.config.maxRetryCount) {
        setTimeout(() => {
          this.sendReport(item)
        }, this.config.retryInterval)
      }
    }
  }

  private handleOnline(): void {
    this.isOnline = true

    // 尝试发送离线队列中的数据
    if (this.offlineQueue.length > 0) {
      const offlineItems = [...this.offlineQueue]
      this.offlineQueue = []

      // 将离线数据重新加入队列
      if (this.config.batchReport) {
        this.queue.unshift(...offlineItems)
        this.processBatch()
      } else {
        offlineItems.forEach(item => this.sendReport(item))
      }
    }
  }

  private handleOffline(): void {
    this.isOnline = false
  }

  private handleBeforeUnload(): void {
    // 清除批处理定时器
    if (this.batchInterval) {
      clearInterval(this.batchInterval)
    }

    // 尝试发送所有剩余数据
    if (this.queue.length > 0 && this.isOnline) {
      // 使用 sendBeacon 发送剩余数据
      if (navigator.sendBeacon && this.config.useBeacon) {
        const blob = new Blob(
          [
            JSON.stringify({
              batch: this.queue.map(item => item.data),
              timestamp: Date.now()
            })
          ],
          { type: 'application/json' }
        )

        navigator.sendBeacon(this.config.endpoint, blob)
      }
    }
  }

  private sendToIntegrations(data: any): void {
    const integrations = this.config.integrations
    if (!integrations) return

    // Sentry 集成
    if (integrations.sentry?.enabled && window.Sentry) {
      try {
        window.Sentry.captureException(data.error || new Error(data.message), {
          extra: data
        })
      } catch (e) {
        console.error('Failed to send to Sentry:', e)
      }
    }

    // LogRocket 集成
    if (integrations.logRocket?.enabled && window.LogRocket) {
      try {
        window.LogRocket.captureException(data.error || new Error(data.message), {
          extra: data
        })
      } catch (e) {
        console.error('Failed to send to LogRocket:', e)
      }
    }

    // 阿里云日志服务集成
    if (integrations.aliyunSls?.enabled && window.AliyunSLS) {
      try {
        window.AliyunSLS.send({
          project: integrations.aliyunSls.project,
          logstore: integrations.aliyunSls.logstore,
          time: Math.floor(Date.now() / 1000),
          contents: this.flattenObject(data)
        })
      } catch (e) {
        console.error('Failed to send to Aliyun SLS:', e)
      }
    }
  }

  private flattenObject(obj: any, prefix: string = ''): Record<string, string> {
    const result: Record<string, string> = {}

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key]
        const newKey = prefix ? `${prefix}.${key}` : key

        if (typeof value === 'object' && value !== null) {
          Object.assign(result, this.flattenObject(value, newKey))
        } else {
          result[newKey] = String(value)
        }
      }
    }

    return result
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
  }

  public destroy(): void {
    if (this.batchInterval) {
      clearInterval(this.batchInterval)
    }

    window.removeEventListener('online', this.handleOnline.bind(this))
    window.removeEventListener('offline', this.handleOffline.bind(this))
    window.removeEventListener('beforeunload', this.handleBeforeUnload.bind(this))
  }
}

// 为第三方集成声明全局类型
declare global {
  interface Window {
    Sentry?: any
    LogRocket?: any
    AliyunSLS?: any
  }
}
