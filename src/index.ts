import { App } from 'vue'
import { ErrorMonitor } from './core/errorMonitor'
import { PerformanceMonitor } from './core/performanceMonitor'
import { RouteMonitor } from './core/routeMonitor'
import { StateMonitor } from './core/stateMonitor'
import { ReportService } from './services/reportService'
import { SourceMapService } from './services/sourceMapService'
import { FallbackService } from './services/fallbackService'
import { WhiteScreenDetector } from './services/whiteScreenDetector'
import { TraceManager } from './utils/traceManager'
import { Config, defaultConfig } from './types/config'

export { ErrorMonitor, PerformanceMonitor, RouteMonitor, StateMonitor, ReportService }

export default {
  install(app: App, userConfig: Partial<Config> = {}) {
    // Validate and merge configurations
    if (!app) {
      throw new Error('Vue app instance is required')
    }
    const config = { ...defaultConfig, ...userConfig }

    // Initialize core services
    const traceManager = new TraceManager() // 初始化 TraceID 管理器
    const reportService = new ReportService(config.reportConfig) // 初始化上报服务
    const sourceMapService = new SourceMapService(config.sourceMapConfig) // 初始化 SourceMap 服务

    // Provide services to the application
    app.provide('traceManager', traceManager)
    app.provide('reportService', reportService)
    app.provide('sourceMapService', sourceMapService)

    // 初始化错误监控
    const errorMonitor = new ErrorMonitor(app, reportService, sourceMapService, config.errorConfig)
    app.provide('errorMonitor', errorMonitor)

    // 初始化性能监控
    const performanceMonitor = new PerformanceMonitor(reportService, config.performanceConfig)
    app.provide('performanceMonitor', performanceMonitor)

    // 初始化白屏检测
    if (config.whiteScreenConfig.enabled) {
      const whiteScreenDetector = new WhiteScreenDetector(reportService, config.whiteScreenConfig)
      app.provide('whiteScreenDetector', whiteScreenDetector)
    }

    // 初始化 Fallback 服务
    if (config.fallbackConfig.enabled) {
      const fallbackService = new FallbackService(config.fallbackConfig)
      app.provide('fallbackService', fallbackService)
    }

    // 初始化路由监控
    if (config.routeConfig.enabled && config.routeConfig.router) {
      const routeMonitor = new RouteMonitor(config.routeConfig.router, reportService, traceManager, config.routeConfig)
      app.provide('routeMonitor', routeMonitor)
    }

    // 初始化状态管理监控
    if (config.stateConfig.enabled) {
      const stateMonitor = new StateMonitor(reportService, config.stateConfig)
      app.provide('stateMonitor', stateMonitor)
    }

    // 全局错误处理组件
    app.component('ErrorBoundary', {
      // 实现在 components/ErrorBoundary.ts
    })

    // 全局 mixin 用于组件级错误捕获
    app.mixin({
      errorCaptured(err, instance, info) {
        errorMonitor.handleComponentError(err as Error, instance, info)
        return false // 阻止错误继续传播
      }
    })
  }
}
