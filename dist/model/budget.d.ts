import type { ModelOperation, ModelUsage, TextCompletionRequest } from "./types.js";
export interface ModelBudget {
    maxAdaptationCalls: number;
    maxTaskCallsPerCase: number;
    maxTotalInputTokens: number;
    maxTotalOutputTokens: number;
    maxCostUsd: number;
}
export interface BudgetSnapshot {
    adaptationCalls: number;
    taskCalls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
}
export declare class BudgetTracker {
    readonly budget: ModelBudget;
    private adaptationCalls;
    private taskCalls;
    private inputTokens;
    private outputTokens;
    private costUsd;
    private readonly callsByTask;
    constructor(budget: ModelBudget);
    assertCanCall(request: TextCompletionRequest): void;
    recordCall(operation: ModelOperation, taskId: string | undefined, usage: ModelUsage): void;
    snapshot(): BudgetSnapshot;
}
