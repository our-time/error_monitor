import { Router } from 'vue-router';
export interface ReportConfig {
    endpoint: string;
    appId: string;
    appVersion: string;
    environment: 'development' | 'production' | 'test';
    maxRetryCount: number;
    retryInterval: number;
    batchReport: boolean;
    batchSize: number;
    batchInterval: number;
    useBeacon: boolean;
    headers?: Record<string, string>;
    beforeReport?: (data: any) => any | false;
    reportLevel?: 'error' | 'warning' | 'info' | 'debug';
    sampleRate?: number;
    integrations?: {
        sentry?: {
            dsn: string;
            enabled: boolean;
        };
        logRocket?: {
            appId: string;
            enabled: boolean;
        };
        aliyunSls?: {
            project: string;
            logstore: string;
            endpoint: string;
            accessKeyId: string;
            accessKeySecret: string;
            enabled: boolean;
        };
    };
}
export interface ErrorConfig {
    ignoreErrors?: Array<string | RegExp>;
    captureGlobalErrors: boolean;
    capturePromiseErrors: boolean;
    captureAjaxErrors: boolean;
    captureConsoleErrors: boolean;
    captureResourceErrors: boolean;
    maxErrorsPerMinute: number;
}
export interface PerformanceConfig {
    capturePageLoad: boolean;
    capturePaint: boolean;
    captureMemory: boolean;
    captureFrameRate: boolean;
    captureFirstContentfulPaint: boolean;
    captureLargestContentfulPaint: boolean;
    captureFirstInputDelay: boolean;
    captureCumulativeLayoutShift: boolean;
    resourceTiming: boolean;
    longTaskThreshold: number;
}
export interface WhiteScreenConfig {
    enabled: boolean;
    timeout: number;
    minValidElements: number;
    validSelectors: string[];
    checkInterval: number;
}
export interface FallbackConfig {
    enabled: boolean;
    fallbackUrl: string;
    errorThreshold: number;
    timeWindow: number;
}
export interface RouteConfig {
    enabled: boolean;
    router?: Router;
    ignorePaths?: string[];
    captureParams: boolean;
    captureQuery: boolean;
    captureHash: boolean;
}
export interface StateConfig {
    enabled: boolean;
    vuex?: any;
    pinia?: any;
    captureActions: boolean;
    captureMutations: boolean;
    captureState: boolean;
    stateSnapshotInterval: number;
    maxStateSize: number;
}
export interface SourceMapConfig {
    enabled: boolean;
    uploadSourceMap: boolean;
    sourceMapEndpoint?: string;
    stripProjectRoot?: string;
    includeSourceContent?: boolean;
}
export interface Config {
    reportConfig: ReportConfig;
    errorConfig: ErrorConfig;
    performanceConfig: PerformanceConfig;
    whiteScreenConfig: WhiteScreenConfig;
    fallbackConfig: FallbackConfig;
    routeConfig: RouteConfig;
    stateConfig: StateConfig;
    sourceMapConfig: SourceMapConfig;
    debug: boolean;
}
export declare const defaultConfig: Config;
