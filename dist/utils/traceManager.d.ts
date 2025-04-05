export declare class TraceManager {
    private traceId;
    private sessionId;
    private pageLoadId;
    constructor();
    private init;
    private getOrCreateSessionId;
    private saveSessionData;
    generateTraceId(): string;
    getTraceId(): string;
    setTraceId(traceId: string): void;
    getSessionId(): string;
    getPageLoadId(): string;
    getTraceInfo(): Record<string, string>;
}
