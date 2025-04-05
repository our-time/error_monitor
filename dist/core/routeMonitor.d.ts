import { Router } from 'vue-router';
import { ReportService } from '../services/reportService';
import { TraceManager } from '../utils/traceManager';
import { RouteConfig } from '../types/config';
export declare class RouteMonitor {
    private router;
    private reportService;
    private traceManager;
    private config;
    private routeStartTime;
    private currentRoute;
    constructor(router: Router, reportService: ReportService, traceManager: TraceManager, config: RouteConfig);
    private init;
    private reportRouteChange;
    private sanitizeRouteData;
}
