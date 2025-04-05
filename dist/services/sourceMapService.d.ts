import { SourceMapConfig } from '../types/config';
export declare class SourceMapService {
    private config;
    constructor(config: SourceMapConfig);
    isEnabled(): boolean;
    mapStackTrace(stack: string): Promise<string>;
    uploadSourceMap(sourceMapFile: File, sourceFile: string): Promise<boolean>;
    private readFileAsText;
}
