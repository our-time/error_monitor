import { ReportConfig } from '../types/config';
export declare class ReportService {
    private config;
    private queue;
    private sending;
    private batchInterval;
    private offlineQueue;
    private isOnline;
    constructor(config: ReportConfig);
    private init;
    reportError(data: any): void;
    reportPerformance(data: any): void;
    private processBatch;
    private sendBatchReport;
    private sendReport;
    private handleOnline;
    private handleOffline;
    private handleBeforeUnload;
    private sendToIntegrations;
    private flattenObject;
    private generateId;
    destroy(): void;
}
declare global {
    interface Window {
        Sentry?: any;
        LogRocket?: any;
        AliyunSLS?: any;
    }
}
