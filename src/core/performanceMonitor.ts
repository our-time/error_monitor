import { ReportService } from '../services/reportService'
import { PerformanceConfig } from '../types/config'

export class PerformanceMonitor {
  private reportService: ReportService
  private config: PerformanceConfig
  private metricsInterval: number | null = null
  private frameRateInterval: number | null = null
  private longTaskObserver: any = null
  private resourceObserver: any = null

  constructor(reportService: ReportService, config: PerformanceConfig) {
    this.reportService = reportService
    this.config = config
    this.init()
  }

  private init(): void {
    if (this.config.capturePageLoad) {
      this.capturePageLoadMetrics()
    }

    if (this.config.capturePaint) {
      this.capturePaintMetrics()
    }

    if (this.config.captureMemory) {
      this.startMemoryMonitoring()
    }

    if (this.config.captureFrameRate) {
      this.startFrameRateMonitoring()
    }

    if (this.config.resourceTiming) {
      this.observeResourceTiming()
    }

    // 监控长任务
    this.observeLongTasks()

    // Web Vitals 指标
    this.captureWebVitals()
  }

  private capturePageLoadMetrics(): void {
    window.addEventListener('load', () => {
      setTimeout(() => {
        const perfData = window.performance.timing
        const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart
        const dnsTime = perfData.domainLookupEnd - perfData.domainLookupStart
        const tcpTime = perfData.connectEnd - perfData.connectStart
        const ttfb = perfData.responseStart - perfData.requestStart
        const domReadyTime = perfData.domContentLoadedEventEnd - perfData.navigationStart
        const domInteractive = perfData.domInteractive - perfData.navigationStart

        this.reportService.reportPerformance({
          type: 'page_load',
          metrics: {
            pageLoadTime,
            dnsTime,
            tcpTime,
            ttfb,
            domReadyTime,
            domInteractive
          },
          url: window.location.href,
          timestamp: new Date().toISOString()
        })
      }, 0)
    })
  }

  private capturePaintMetrics(): void {
    const observer = new PerformanceObserver(list => {
      const entries = list.getEntries()

      entries.forEach(entry => {
        if (entry.name === 'first-paint' || entry.name === 'first-contentful-paint') {
          this.reportService.reportPerformance({
            type: 'paint',
            metrics: {
              name: entry.name,
              startTime: entry.startTime
            },
            url: window.location.href,
            timestamp: new Date().toISOString()
          })
        }
      })
    })

    observer.observe({ entryTypes: ['paint'] })
  }

  private startMemoryMonitoring(): void {
    if (performance && (performance as any).memory) {
      this.metricsInterval = window.setInterval(() => {
        const memoryInfo = (performance as any).memory

        this.reportService.reportPerformance({
          type: 'memory',
          metrics: {
            jsHeapSizeLimit: memoryInfo.jsHeapSizeLimit,
            totalJSHeapSize: memoryInfo.totalJSHeapSize,
            usedJSHeapSize: memoryInfo.usedJSHeapSize
          },
          url: window.location.href,
          timestamp: new Date().toISOString()
        })
      }, 30000) // 每30秒采集一次
    }
  }

  private startFrameRateMonitoring(): void {
    let lastTime = performance.now()
    let frames = 0

    const calculateFPS = () => {
      const now = performance.now()
      const delta = now - lastTime

      if (delta >= 1000) {
        const fps = Math.round((frames * 1000) / delta)

        this.reportService.reportPerformance({
          type: 'fps',
          metrics: { fps },
          url: window.location.href,
          timestamp: new Date().toISOString()
        })

        frames = 0
        lastTime = now
      }

      frames++
      requestAnimationFrame(calculateFPS)
    }

    requestAnimationFrame(calculateFPS)
  }

  private observeResourceTiming(): void {
    this.resourceObserver = new PerformanceObserver(list => {
      const entries = list.getEntries()

      entries.forEach(entry => {
        if (
          ['script', 'link', 'img', 'css', 'fetch', 'xmlhttprequest'].includes(
            (entry as PerformanceResourceTiming).initiatorType
          )
        ) {
          this.reportService.reportPerformance({
            type: 'resource',
            metrics: {
              name: entry.name,
              initiatorType: (entry as PerformanceResourceTiming).initiatorType,
              duration: entry.duration,
              transferSize: (entry as PerformanceResourceTiming).transferSize || 0,
              decodedBodySize: (entry as PerformanceResourceTiming).decodedBodySize || 0
            },
            url: window.location.href,
            timestamp: new Date().toISOString()
          })
        }
      })
    })

    this.resourceObserver.observe({ entryTypes: ['resource'] })
  }

  private observeLongTasks(): void {
    if ('PerformanceLongTaskTiming' in window) {
      this.longTaskObserver = new PerformanceObserver(list => {
        const entries = list.getEntries()

        entries.forEach(entry => {
          if (entry.duration > this.config.longTaskThreshold) {
            this.reportService.reportPerformance({
              type: 'long_task',
              metrics: {
                duration: entry.duration,
                startTime: entry.startTime
              },
              url: window.location.href,
              timestamp: new Date().toISOString()
            })
          }
        })
      })

      this.longTaskObserver.observe({ entryTypes: ['longtask'] })
    }
  }

  private captureWebVitals(): void {
    if (this.config.captureFirstContentfulPaint) {
      this.captureFCP()
    }

    if (this.config.captureLargestContentfulPaint) {
      this.captureLCP()
    }

    if (this.config.captureFirstInputDelay) {
      this.captureFID()
    }

    if (this.config.captureCumulativeLayoutShift) {
      this.captureCLS()
    }
  }

  private captureFCP(): void {
    const fcpObserver = new PerformanceObserver(list => {
      const entries = list.getEntries()
      entries.forEach(entry => {
        this.reportService.reportPerformance({
          type: 'web_vital',
          name: 'FCP',
          metrics: {
            value: entry.startTime,
            rating: this.getRating('FCP', entry.startTime)
          },
          url: window.location.href,
          timestamp: new Date().toISOString()
        })
      })
      fcpObserver.disconnect()
    })

    fcpObserver.observe({ type: 'paint', buffered: true })
  }

  private captureLCP(): void {
    let lcp: PerformanceEntry | null = null

    const lcpObserver = new PerformanceObserver(list => {
      const entries = list.getEntries()
      // 取最后一个 LCP 事件
      lcp = entries[entries.length - 1]
    })

    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true })

    // 页面卸载时报告最终 LCP 值
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && lcp) {
        this.reportService.reportPerformance({
          type: 'web_vital',
          name: 'LCP',
          metrics: {
            value: lcp.startTime,
            rating: this.getRating('LCP', lcp.startTime),
            element: (lcp as any).element ? (lcp as any).element.tagName : null
          },
          url: window.location.href,
          timestamp: new Date().toISOString()
        })
        lcpObserver.disconnect()
      }
    })
  }

  private captureFID(): void {
    const fidObserver = new PerformanceObserver(list => {
      const entries = list.getEntries()
      entries.forEach(entry => {
        // Cast to PerformanceEventTiming to access processingStart
        this.reportService.reportPerformance({
          type: 'web_vital',
          name: 'FID',
          metrics: {
            value: (entry as PerformanceEventTiming).processingStart - entry.startTime,
            rating: this.getRating('FID', (entry as PerformanceEventTiming).processingStart - entry.startTime)
          },
          url: window.location.href,
          timestamp: new Date().toISOString()
        })
      })
    })

    fidObserver.observe({ type: 'first-input', buffered: true })
  }

  private captureCLS(): void {
    let clsValue = 0
    let clsEntries: PerformanceEntry[] = []

    const clsObserver = new PerformanceObserver(list => {
      const entries = list.getEntries()

      entries.forEach(entry => {
        // 不计算用户交互后 500ms 内的布局偏移
        if (!(entry as any).hadRecentInput) {
          clsValue += (entry as any).value
          clsEntries.push(entry)
        }
      })
    })

    clsObserver.observe({ type: 'layout-shift', buffered: true })

    // 页面卸载时报告累积的 CLS 值
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.reportService.reportPerformance({
          type: 'web_vital',
          name: 'CLS',
          metrics: {
            value: clsValue,
            rating: this.getRating('CLS', clsValue),
            entries: clsEntries.length
          },
          url: window.location.href,
          timestamp: new Date().toISOString()
        })
      }
    })
  }

  private getRating(metric: string, value: number): 'good' | 'needs-improvement' | 'poor' {
    switch (metric) {
      case 'FCP':
        return value <= 1800 ? 'good' : value <= 3000 ? 'needs-improvement' : 'poor'
      case 'LCP':
        return value <= 2500 ? 'good' : value <= 4000 ? 'needs-improvement' : 'poor'
      case 'FID':
        return value <= 100 ? 'good' : value <= 300 ? 'needs-improvement' : 'poor'
      case 'CLS':
        return value <= 0.1 ? 'good' : value <= 0.25 ? 'needs-improvement' : 'poor'
      default:
        return 'needs-improvement'
    }
  }

  public destroy(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval)
    }

    if (this.frameRateInterval) {
      clearInterval(this.frameRateInterval)
    }

    if (this.longTaskObserver) {
      this.longTaskObserver.disconnect()
    }

    if (this.resourceObserver) {
      this.resourceObserver.disconnect()
    }
  }
}
