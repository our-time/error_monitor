import { App, ComponentPublicInstance } from 'vue';
import { ReportService } from '../services/reportService';
import { SourceMapService } from '../services/sourceMapService';
import { ErrorConfig } from '../types/config';
declare global {
    interface XMLHttpRequest {
        _url?: string;
        _method?: string;
    }
}
export declare class ErrorMonitor {
    private app;
    private reportService;
    private sourceMapService;
    private config;
    private errorCount;
    private errorCountResetInterval;
    constructor(app: App, reportService: ReportService, sourceMapService: SourceMapService, config: ErrorConfig);
    private init;
    private setupGlobalErrorHandler;
    private setupPromiseErrorHandler;
    private setupAjaxErrorHandler;
    private setupResourceErrorHandler;
    private isResourceError;
    handleJsError(error: Error, context?: Record<string, any>): void;
    handleComponentError(error: Error, instance: ComponentPublicInstance | null, info: string): void;
    private handleNetworkError;
    private handleResourceError;
    private processAndReportError;
    private shouldIgnoreError;
    private isRateLimited;
    private sanitizeComponentData;
    destroy(): void;
}
