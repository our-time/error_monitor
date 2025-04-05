import { FallbackConfig } from '../types/config'

export class FallbackService {
  private config: FallbackConfig
  private errorCount: number = 0
  private errorTimestamps: number[] = []

  constructor(config: FallbackConfig) {
    this.config = config
    this.init()
  }

  private init(): void {
    // 监听全局错误以计数
    window.addEventListener('error', this.handleError.bind(this))
    window.addEventListener('unhandledrejection', this.handleError.bind(this))
  }

  private handleError(event: Event): void {
    console.log(event)
    const now = Date.now()

    // 添加当前错误时间戳
    this.errorTimestamps.push(now)

    // 清理超出时间窗口的错误
    this.errorTimestamps = this.errorTimestamps.filter(timestamp => now - timestamp <= this.config.timeWindow)

    // 更新错误计数
    this.errorCount = this.errorTimestamps.length

    // 检查是否需要跳转到 fallback 页面
    if (this.errorCount >= this.config.errorThreshold) {
      this.redirectToFallback()
    }
  }

  private redirectToFallback(): void {
    // 防止循环重定向
    if (window.location.pathname === this.config.fallbackUrl) {
      return
    }

    // 保存当前 URL 以便恢复
    sessionStorage.setItem('errorMonitor_previousUrl', window.location.href)

    // 跳转到 fallback 页面
    window.location.href = this.config.fallbackUrl
  }

  public destroy(): void {
    window.removeEventListener('error', this.handleError.bind(this))
    window.removeEventListener('unhandledrejection', this.handleError.bind(this))
  }
}
