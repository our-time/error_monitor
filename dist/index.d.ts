import { App } from 'vue';
import { ErrorMonitor } from './core/errorMonitor';
import { PerformanceMonitor } from './core/performanceMonitor';
import { RouteMonitor } from './core/routeMonitor';
import { StateMonitor } from './core/stateMonitor';
import { ReportService } from './services/reportService';
import { Config } from './types/config';
export { ErrorMonitor, PerformanceMonitor, RouteMonitor, StateMonitor, ReportService };
declare const _default: {
    install(app: App, userConfig?: Partial<Config>): void;
};
export default _default;
