import { Router } from 'vue-router'
export interface ReportConfig {
  endpoint: string
  appId: string
  appVersion: string
  environment: 'development' | 'production' | 'test'
  maxRetryCount: number
  retryInterval: number
  batchReport: boolean
  batchSize: number
  batchInterval: number
  useBeacon: boolean
  headers?: Record<string, string>
  beforeReport?: (data: any) => any | false
  reportLevel?: 'error' | 'warning' | 'info' | 'debug'
  sampleRate?: number
  integrations?: {
    sentry?: {
      dsn: string
      enabled: boolean
    }
    logRocket?: {
      appId: string
      enabled: boolean
    }
    aliyunSls?: {
      project: string
      logstore: string
      endpoint: string
      accessKeyId: string
      accessKeySecret: string
      enabled: boolean
    }
  }
}

export interface ErrorConfig {
  ignoreErrors?: Array<string | RegExp>
  captureGlobalErrors: boolean
  capturePromiseErrors: boolean
  captureAjaxErrors: boolean
  captureConsoleErrors: boolean
  captureResourceErrors: boolean
  maxErrorsPerMinute: number
}

export interface PerformanceConfig {
  capturePageLoad: boolean
  capturePaint: boolean
  captureMemory: boolean
  captureFrameRate: boolean
  captureFirstContentfulPaint: boolean
  captureLargestContentfulPaint: boolean
  captureFirstInputDelay: boolean
  captureCumulativeLayoutShift: boolean
  resourceTiming: boolean
  longTaskThreshold: number
}

export interface WhiteScreenConfig {
  enabled: boolean
  timeout: number
  minValidElements: number
  validSelectors: string[]
  checkInterval: number
}

export interface FallbackConfig {
  enabled: boolean
  fallbackUrl: string
  errorThreshold: number
  timeWindow: number
}

export interface RouteConfig {
  enabled: boolean
  router?: Router
  ignorePaths?: string[]
  captureParams: boolean
  captureQuery: boolean
  captureHash: boolean
}

export interface StateConfig {
  enabled: boolean
  vuex?: any
  pinia?: any
  captureActions: boolean
  captureMutations: boolean
  captureState: boolean
  stateSnapshotInterval: number
  maxStateSize: number
}

export interface SourceMapConfig {
  enabled: boolean
  uploadSourceMap: boolean
  sourceMapEndpoint?: string
  stripProjectRoot?: string
  includeSourceContent?: boolean
}

export interface Config {
  reportConfig: ReportConfig
  errorConfig: ErrorConfig
  performanceConfig: PerformanceConfig
  whiteScreenConfig: WhiteScreenConfig
  fallbackConfig: FallbackConfig
  routeConfig: RouteConfig
  stateConfig: StateConfig
  sourceMapConfig: SourceMapConfig
  debug: boolean
}

export const defaultConfig: Config = {
  reportConfig: {
    endpoint: '/api/error-report',
    appId: '',
    appVersion: '1.0.0',
    environment: 'production',
    maxRetryCount: 3,
    retryInterval: 3000,
    batchReport: true,
    batchSize: 10,
    batchInterval: 5000,
    useBeacon: true,
    reportLevel: 'error',
    sampleRate: 1.0
  },
  errorConfig: {
    ignoreErrors: [/^Network Error$/i, /^Script error\.?$/i],
    captureGlobalErrors: true,
    capturePromiseErrors: true,
    captureAjaxErrors: true,
    captureConsoleErrors: true,
    captureResourceErrors: true,
    maxErrorsPerMinute: 30
  },
  performanceConfig: {
    capturePageLoad: true,
    capturePaint: true,
    captureMemory: true,
    captureFrameRate: false,
    captureFirstContentfulPaint: true,
    captureLargestContentfulPaint: true,
    captureFirstInputDelay: true,
    captureCumulativeLayoutShift: true,
    resourceTiming: true,
    longTaskThreshold: 50
  },
  whiteScreenConfig: {
    enabled: true,
    timeout: 5000,
    minValidElements: 5,
    validSelectors: ['div', 'p', 'img', 'button', 'a'],
    checkInterval: 1000
  },
  fallbackConfig: {
    enabled: true,
    fallbackUrl: '/error',
    errorThreshold: 3,
    timeWindow: 60000
  },
  routeConfig: {
    enabled: false,
    captureParams: false,
    captureQuery: true,
    captureHash: false
  },
  stateConfig: {
    enabled: false,
    captureActions: true,
    captureMutations: true,
    captureState: true,
    stateSnapshotInterval: 30000,
    maxStateSize: 100000
  },
  sourceMapConfig: {
    enabled: true,
    uploadSourceMap: false,
    stripProjectRoot: '',
    includeSourceContent: false
  },
  debug: false
}
