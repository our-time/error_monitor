import { ReportService } from './reportService';
import { WhiteScreenConfig } from '../types/config';
export declare class WhiteScreenDetector {
    private reportService;
    private config;
    private checkInterval;
    private hasReported;
    constructor(reportService: ReportService, config: WhiteScreenConfig);
    private init;
    private startDetection;
    private checkForWhiteScreen;
    private isPageWhiteScreen;
    private reportWhiteScreen;
    private getSafeHtmlSnapshot;
    private stopDetection;
    destroy(): void;
}
