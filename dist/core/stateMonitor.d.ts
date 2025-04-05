import { ReportService } from '../services/reportService';
import { StateConfig } from '../types/config';
export declare class StateMonitor {
    private reportService;
    private config;
    private stateSnapshotInterval;
    constructor(reportService: ReportService, config: StateConfig);
    private init;
    private setupVuexMonitoring;
    private setupPiniaMonitoring;
    private startStateSnapshotCapture;
    private reportStateChange;
    private reportStateError;
    private sanitizeState;
    private sanitizePayload;
    destroy(): void;
}
