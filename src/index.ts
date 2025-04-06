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
import ErrorBoundary from './components/ErrorBoundary'
import { Config, defaultConfig, ErrorMonitorPluginConfig } from './types/config'

// 导出核心类以便用户可以单独使用
export {
  ErrorMonitor,
  PerformanceMonitor,
  RouteMonitor,
  StateMonitor,
  ReportService,
  TraceManager,
  SourceMapService,
  FallbackService,
  WhiteScreenDetector,
  ErrorBoundary
}

// 创建一个类型表示所有可注入的服务
export type MonitorServices = {
  traceManager: TraceManager
  reportService: ReportService
  sourceMapService: SourceMapService
  errorMonitor: ErrorMonitor
  performanceMonitor: PerformanceMonitor
  whiteScreenDetector?: WhiteScreenDetector
  fallbackService?: FallbackService
  routeMonitor?: RouteMonitor
  stateMonitor?: StateMonitor
}

// 创建和导出独立的插件对象
const MonitorPlugin = {
  install(app: App, userConfig: Partial<Config> = {}) {
    // 验证并合并配置
    if (!app) {
      throw new Error('Vue app instance is required')
    }

    const config = { ...defaultConfig, ...userConfig }
    const services: Partial<MonitorServices> = {}

    // 初始化核心服务
    services.traceManager = new TraceManager()
    services.reportService = new ReportService(config.reportConfig)
    services.sourceMapService = new SourceMapService(config.sourceMapConfig)

    // 初始化错误监控 - 始终启用
    services.errorMonitor = new ErrorMonitor(app, services.reportService, services.sourceMapService, config.errorConfig)

    // 初始化性能监控 - 始终启用
    services.performanceMonitor = new PerformanceMonitor(services.reportService, config.performanceConfig)

    // 按需初始化可选服务
    if (config.whiteScreenConfig.enabled) {
      services.whiteScreenDetector = new WhiteScreenDetector(services.reportService, config.whiteScreenConfig)
    }

    if (config.fallbackConfig.enabled) {
      services.fallbackService = new FallbackService({
        ...config.fallbackConfig,
        router: config.routeConfig.enabled ? config.routeConfig.router : undefined
      })
    }

    if (config.routeConfig.enabled && config.routeConfig.router) {
      services.routeMonitor = new RouteMonitor(
        config.routeConfig.router,
        services.reportService,
        services.traceManager,
        config.routeConfig
      )
    }

    if (config.stateConfig.enabled) {
      services.stateMonitor = new StateMonitor(services.reportService, config.stateConfig)
    }

    // 统一注册所有服务
    Object.entries(services).forEach(([key, service]) => {
      if (service) {
        app.provide(key, service)
      }
    })

    // 注册错误边界组件
    app.component('ErrorBoundary', ErrorBoundary)

    // 全局 mixin 用于组件级错误捕获
    app.mixin({
      errorCaptured(err, instance, info) {
        if (services.errorMonitor) {
          services.errorMonitor.handleComponentError(err as Error, instance, info)
        }
        return false // 阻止错误继续传播
      }
    })

    // 返回服务实例，方便用户在安装插件后直接访问
    return services
  }
}

// 为各个组件创建单独的插件安装函数
export const createErrorMonitorPlugin = (config: ErrorMonitorPluginConfig) => ({
  install(app: App) {
    const reportService = new ReportService(config?.reportConfig ?? defaultConfig.reportConfig)
    const sourceMapService = new SourceMapService(config?.sourceMapConfig ?? defaultConfig.sourceMapConfig)
    const errorConfig = config?.errorConfig || {}

    const errorMonitor = new ErrorMonitor(app, reportService, sourceMapService, {
      ...defaultConfig.errorConfig,
      ...errorConfig
    })
    app.provide('errorMonitor', errorMonitor)
    app.provide('reportService', reportService)
    app.provide('sourceMapService', sourceMapService)

    // 注册错误边界组件
    app.component('ErrorBoundary', ErrorBoundary)

    // 全局 mixin 用于组件级错误捕获
    app.mixin({
      errorCaptured(err, instance, info) {
        errorMonitor.handleComponentError(err as Error, instance, info)
        return false
      }
    })

    return { errorMonitor, reportService, sourceMapService }
  }
})

// 导出默认插件
export default MonitorPlugin
