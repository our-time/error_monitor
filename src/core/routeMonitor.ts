import { Router } from 'vue-router'
import { ReportService } from '../services/reportService'
import { TraceManager } from '../utils/traceManager'
import { RouteConfig } from '../types/config'

export class RouteMonitor {
  private router: Router
  private reportService: ReportService
  private traceManager: TraceManager
  private config: RouteConfig
  private routeStartTime: number = 0
  private currentRoute: string = ''

  constructor(router: Router, reportService: ReportService, traceManager: TraceManager, config: RouteConfig) {
    this.router = router
    this.reportService = reportService
    this.traceManager = traceManager
    this.config = config
    this.init()
  }

  private init(): void {
    // 路由开始变化前
    this.router.beforeEach((to, from, next) => {
      // 记录路由开始时间
      this.routeStartTime = performance.now()

      // 生成新的 traceId 用于跟踪整个页面生命周期
      const traceId = this.traceManager.generateTraceId()
      this.traceManager.setTraceId(traceId)

      // 记录当前路由
      this.currentRoute = to.fullPath

      // 上报路由开始事件
      this.reportRouteChange('route_start', to, from)

      next()
    })

    // 路由变化后
    this.router.afterEach((to, from) => {
      const duration = performance.now() - this.routeStartTime

      // 上报路由完成事件
      this.reportRouteChange('route_complete', to, from, duration)
    })

    // 路由错误
    this.router.onError(error => {
      this.reportService.reportError({
        type: 'route_error',
        message: error.message,
        stack: error.stack,
        url: window.location.href,
        route: this.currentRoute,
        traceId: this.traceManager.getTraceId(),
        timestamp: new Date().toISOString()
      })
    })
  }

  private reportRouteChange(eventType: 'route_start' | 'route_complete', to: any, from: any, duration?: number): void {
    // 检查是否应该忽略此路径
    if (this.config.ignorePaths && this.config.ignorePaths.some(path => to.path.includes(path))) {
      return
    }

    const reportData: any = {
      type: eventType,
      from: this.sanitizeRouteData(from),
      to: this.sanitizeRouteData(to),
      timestamp: new Date().toISOString(),
      traceId: this.traceManager.getTraceId()
    }

    if (duration !== undefined) {
      reportData.duration = duration
    }

    this.reportService.reportPerformance(reportData)
  }

  private sanitizeRouteData(route: any): any {
    if (!route) return null

    const result: any = {
      path: route.path,
      name: route.name
    }

    if (this.config.captureParams) {
      result.params = route.params
    }

    if (this.config.captureQuery) {
      result.query = route.query
    }

    if (this.config.captureHash) {
      result.hash = route.hash
    }

    return result
  }
}
