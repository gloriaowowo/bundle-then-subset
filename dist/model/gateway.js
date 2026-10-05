import { hashArtifact } from "../eval/manifest.js";
import { ModelBackendError } from "./types.js";
const ZERO_USAGE = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    latencyMs: 0,
    costUsd: 0,
};
function parseJsonResponse(rawText) {
    const trimmed = rawText.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
    const candidate = fenced?.[1] ?? trimmed;
    try {
        return JSON.parse(candidate);
    }
    catch (error) {
        throw new Error(`Model returned invalid JSON: ${error.message}`);
    }
}
export class JsonModelGateway {
    backend;
    budget;
    cache;
    logicalCalls = 0;
    cacheHits = 0;
    providerCalls = 0;
    providerInputTokens = 0;
    providerOutputTokens = 0;
    providerCostUsd = 0;
    constructor(backend, budget, cache) {
        this.backend = backend;
        this.budget = budget;
        this.cache = cache;
    }
    async complete(request) {
        const requestHash = hashArtifact({
            descriptor: this.backend.descriptor,
            request: {
                systemPrompt: request.systemPrompt,
                userPrompt: request.userPrompt,
                maxOutputTokens: request.maxOutputTokens,
                operation: request.operation,
                organizationId: request.organizationId,
                checkpoint: request.checkpoint,
                taskId: request.taskId ?? null,
                trialSeed: request.trialSeed,
            },
        });
        this.budget.assertCanCall(request);
        this.logicalCalls += 1;
        const cached = await this.cache.get(requestHash);
        if (cached) {
            this.cacheHits += 1;
            this.budget.recordCall(request.operation, request.taskId, cached.usage);
            return {
                value: parseJsonResponse(cached.rawText),
                rawText: cached.rawText,
                requestHash,
                usage: cached.usage,
                cacheHit: true,
            };
        }
        this.providerCalls += 1;
        let response;
        try {
            response = await this.backend.complete(request);
        }
        catch (error) {
            const usage = error instanceof ModelBackendError ? error.usage : ZERO_USAGE;
            this.recordProviderUsage(usage);
            this.budget.recordCall(request.operation, request.taskId, usage);
            throw error;
        }
        this.recordProviderUsage(response.usage);
        this.budget.recordCall(request.operation, request.taskId, response.usage);
        const value = parseJsonResponse(response.text);
        await this.cache.put({
            schemaVersion: 1,
            requestHash,
            rawText: response.text,
            usage: response.usage,
        });
        return {
            value,
            rawText: response.text,
            requestHash,
            usage: response.usage,
            cacheHit: false,
        };
    }
    stats() {
        return {
            logicalCalls: this.logicalCalls,
            cacheHits: this.cacheHits,
            providerCalls: this.providerCalls,
            providerInputTokens: this.providerInputTokens,
            providerOutputTokens: this.providerOutputTokens,
            providerCostUsd: this.providerCostUsd,
        };
    }
    recordProviderUsage(usage) {
        this.providerInputTokens += usage.inputTokens;
        this.providerOutputTokens += usage.outputTokens;
        this.providerCostUsd += usage.costUsd;
    }
}
//# sourceMappingURL=gateway.js.map