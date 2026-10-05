export class BudgetTracker {
    budget;
    adaptationCalls = 0;
    taskCalls = 0;
    inputTokens = 0;
    outputTokens = 0;
    costUsd = 0;
    callsByTask = new Map();
    constructor(budget) {
        this.budget = budget;
    }
    assertCanCall(request) {
        if (request.operation === "adaptation" && this.adaptationCalls >= this.budget.maxAdaptationCalls) {
            throw new Error("Adaptation model-call budget exceeded.");
        }
        if (request.operation === "task_inference") {
            if (!request.taskId) {
                throw new Error("Task-inference requests require a taskId.");
            }
            const taskCalls = this.callsByTask.get(request.taskId) ?? 0;
            if (taskCalls >= this.budget.maxTaskCallsPerCase) {
                throw new Error(`Task model-call budget exceeded for ${request.taskId}.`);
            }
        }
        if (this.inputTokens >= this.budget.maxTotalInputTokens) {
            throw new Error("Input-token budget exhausted.");
        }
        if (this.outputTokens >= this.budget.maxTotalOutputTokens) {
            throw new Error("Output-token budget exhausted.");
        }
        if (this.costUsd >= this.budget.maxCostUsd) {
            throw new Error("Model-cost budget exhausted.");
        }
    }
    recordCall(operation, taskId, usage) {
        if (operation === "adaptation") {
            this.adaptationCalls += 1;
        }
        else {
            if (!taskId) {
                throw new Error("Task-inference usage requires a taskId.");
            }
            this.taskCalls += 1;
            this.callsByTask.set(taskId, (this.callsByTask.get(taskId) ?? 0) + 1);
        }
        this.inputTokens += usage.inputTokens;
        this.outputTokens += usage.outputTokens;
        this.costUsd += usage.costUsd;
        if (this.inputTokens > this.budget.maxTotalInputTokens) {
            throw new Error("Input-token budget exceeded by completed request.");
        }
        if (this.outputTokens > this.budget.maxTotalOutputTokens) {
            throw new Error("Output-token budget exceeded by completed request.");
        }
        if (this.costUsd > this.budget.maxCostUsd) {
            throw new Error("Model-cost budget exceeded by completed request.");
        }
    }
    snapshot() {
        return {
            adaptationCalls: this.adaptationCalls,
            taskCalls: this.taskCalls,
            inputTokens: this.inputTokens,
            outputTokens: this.outputTokens,
            costUsd: this.costUsd,
        };
    }
}
//# sourceMappingURL=budget.js.map