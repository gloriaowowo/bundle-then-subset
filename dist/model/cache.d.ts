import type { ModelUsage } from "./types.js";
export interface CachedModelResponse {
    schemaVersion: 1;
    requestHash: string;
    rawText: string;
    usage: ModelUsage;
}
export declare class FileModelCache {
    private readonly cacheDirectory;
    constructor(cacheDirectory: string);
    get(requestHash: string): Promise<CachedModelResponse | undefined>;
    put(value: CachedModelResponse): Promise<string>;
    private pathFor;
}
