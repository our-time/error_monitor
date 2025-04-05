import { ReportService } from './reportService'
import { WhiteScreenConfig } from '../types/config'

export class WhiteScreenDetector {
  private reportService: ReportService
  private config: WhiteScreenConfig
  private checkInterval: number | null = null
  private hasReported: boolean = false

  constructor(reportService: ReportService, config: WhiteScreenConfig) {
    this.reportService = reportService
    this.config = config
    this.init()
  }

  private init(): void {
    // 页面加载完成后开始检测
    if (document.readyState === 'complete') {
      this.startDetection()
    } else {
      window.addEventListener('load', () => {
        this.startDetection()
      })
    }
  }

  private startDetection(): void {
    // 设置超时检测
    setTimeout(() => {
      this.checkForWhiteScreen()
    }, this.config.timeout)

    // 定期检测
    if (this.config.checkInterval > 0) {
      this.checkInterval = window.setInterval(() => {
        this.checkForWhiteScreen()
      }, this.config.checkInterval)
    }
  }

  private checkForWhiteScreen(): void {
    // 如果已经报告过，不再重复检测
    if (this.hasReported) {
      this.stopDetection()
      return
    }

    // 检查页面是否为白屏
    const isWhiteScreen = this.isPageWhiteScreen()

    if (isWhiteScreen) {
      this.reportWhiteScreen()
      this.hasReported = true
      this.stopDetection()
    }
  }

  private isPageWhiteScreen(): boolean {
    // 获取有效元素数量
    let validElementsCount = 0

    // 检查指定选择器的元素
    for (const selector of this.config.validSelectors) {
      validElementsCount += document.querySelectorAll(selector).length
    }

    // 如果有效元素数量少于阈值，认为是白屏
    return validElementsCount < this.config.minValidElements
  }

  private reportWhiteScreen(): void {
    // 收集页面信息
    const pageInfo = {
      url: window.location.href,
      userAgent: navigator.userAgent,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      domContentLoaded: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart,
      loadTime: performance.timing.loadEventEnd - performance.timing.navigationStart,
      htmlContent: this.getSafeHtmlSnapshot()
    }

    // 上报白屏事件
    this.reportService.reportError({
      type: 'white_screen',
      message: 'White screen detected',
      pageInfo,
      timestamp: new Date().toISOString()
    })
  }

  private getSafeHtmlSnapshot(): string {
    try {
      // 获取 HTML 快照，但限制大小
      const html = document.documentElement.outerHTML
      const maxLength = 5000 // 限制 HTML 大小

      return html.length > maxLength ? html.substring(0, maxLength) + '...' : html
    } catch (e) {
      return 'Failed to capture HTML snapshot'
    }
  }

  private stopDetection(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  public destroy(): void {
    this.stopDetection()
  }
}
