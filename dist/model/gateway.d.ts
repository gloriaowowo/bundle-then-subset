import type { BudgetTracker } from "./budget.js";
import type { FileModelCache } from "./cache.js";
import type { JsonCompletionResult, TextCompletionRequest, TextModelBackend } from "./types.js";
export declare class JsonModelGateway {
    private readonly backend;
    private readonly budget;
    private readonly cache;
    private logicalCalls;
    private cacheHits;
    private providerCalls;
    private providerInputTokens;
    private providerOutputTokens;
    private providerCostUsd;
    constructor(backend: TextModelBackend, budget: BudgetTracker, cache: FileModelCache);
    complete(request: TextCompletionRequest): Promise<JsonCompletionResult>;
    stats(): {
        logicalCalls: number;
        cacheHits: number;
        providerCalls: number;
        providerInputTokens: number;
        providerOutputTokens: number;
        providerCostUsd: number;
    };
    private recordProviderUsage;
}
