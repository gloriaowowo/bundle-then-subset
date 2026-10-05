import assert from "node:assert/strict";
import path from "node:path";
import { BudgetTracker } from "./model/budget.js";
import { FileModelCache } from "./model/cache.js";
import { JsonModelGateway } from "./model/gateway.js";
import { ModelBackendError } from "./model/types.js";
let backendCalls = 0;
const backend = {
    descriptor: { provider: "fixture", id: "deterministic-json", temperature: 0 },
    complete: async (_request) => {
        backendCalls += 1;
        return {
            text: '```json\n{"ok":true}\n```',
            usage: {
                inputTokens: 10,
                outputTokens: 4,
                totalTokens: 14,
                latencyMs: 1,
                costUsd: 0,
            },
        };
    },
};
const tracker = new BudgetTracker({
    maxAdaptationCalls: 2,
    maxTaskCallsPerCase: 1,
    maxTotalInputTokens: 100,
    maxTotalOutputTokens: 100,
    maxCostUsd: 1,
});
const cache = new FileModelCache(path.join(process.cwd(), "runs", `gate-model-cache-${process.pid}-${Date.now()}`));
const gateway = new JsonModelGateway(backend, tracker, cache);
const request = {
    systemPrompt: "Return JSON.",
    userPrompt: "Return ok=true for the deterministic gateway gate.",
    maxOutputTokens: 20,
    operation: "adaptation",
    organizationId: "gateway-test",
    checkpoint: 0,
    trialSeed: 0,
};
const first = await gateway.complete(request);
const second = await gateway.complete(request);
assert.deepEqual(first.value, { ok: true });
assert.deepEqual(second.value, { ok: true });
assert.equal(second.cacheHit, true);
assert.equal(backendCalls, 1);
assert.equal(tracker.snapshot().adaptationCalls, 2);
assert.deepEqual(gateway.stats(), {
    logicalCalls: 2,
    cacheHits: 1,
    providerCalls: 1,
});
const failedTracker = new BudgetTracker({
    maxAdaptationCalls: 1,
    maxTaskCallsPerCase: 1,
    maxTotalInputTokens: 100,
    maxTotalOutputTokens: 100,
    maxCostUsd: 1,
});
const failedGateway = new JsonModelGateway({
    descriptor: { provider: "fixture", id: "billable-failure", temperature: 0 },
    complete: async () => {
        throw new ModelBackendError("fixture empty response", {
            inputTokens: 12,
            outputTokens: 20,
            totalTokens: 32,
            latencyMs: 1,
            costUsd: 0.01,
        });
    },
}, failedTracker, new FileModelCache(path.join(process.cwd(), "runs", `gate-model-failed-cache-${process.pid}-${Date.now()}`)));
await assert.rejects(() => failedGateway.complete(request), /fixture empty response/);
assert.deepEqual(failedTracker.snapshot(), {
    adaptationCalls: 1,
    taskCalls: 0,
    inputTokens: 12,
    outputTokens: 20,
    costUsd: 0.01,
});
const overBudgetRequest = { ...request, userPrompt: `${request.userPrompt} Different hash.` };
await assert.rejects(() => gateway.complete(overBudgetRequest), /budget exceeded/);
console.log(JSON.stringify({
    gate: "model-gateway",
    jsonParsing: true,
    cacheHit: true,
    budgetEnforced: true,
    failedUsageAccounted: true,
    paidModelRequestMade: false,
}, null, 2));
//# sourceMappingURL=gate-model.js.map