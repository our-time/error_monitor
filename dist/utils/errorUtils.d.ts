interface ErrorInfo {
    message: string;
    name: string;
    stack: string;
}
export declare function getErrorInfo(error: Error | any): ErrorInfo;
export declare function generateErrorId(errorInfo: ErrorInfo): string;
export {};
