import { FallbackConfig } from '../types/config';
export declare class FallbackService {
    private config;
    private errorCount;
    private errorTimestamps;
    constructor(config: FallbackConfig);
    private init;
    private handleError;
    private redirectToFallback;
    destroy(): void;
}
