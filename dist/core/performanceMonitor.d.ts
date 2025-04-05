import { ReportService } from '../services/reportService';
import { PerformanceConfig } from '../types/config';
export declare class PerformanceMonitor {
    private reportService;
    private config;
    private metricsInterval;
    private frameRateInterval;
    private longTaskObserver;
    private resourceObserver;
    constructor(reportService: ReportService, config: PerformanceConfig);
    private init;
    private capturePageLoadMetrics;
    private capturePaintMetrics;
    private startMemoryMonitoring;
    private startFrameRateMonitoring;
    private observeResourceTiming;
    private observeLongTasks;
    private captureWebVitals;
    private captureFCP;
    private captureLCP;
    private captureFID;
    private captureCLS;
    private getRating;
    destroy(): void;
}
