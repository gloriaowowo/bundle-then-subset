import { contentText, } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { ModelBackendError } from "./types.js";
export class PiTextBackend {
    models;
    model;
    config;
    descriptor;
    constructor(models, model, config) {
        this.models = models;
        this.model = model;
        this.config = config;
        this.descriptor = {
            provider: model.provider,
            id: model.id,
            temperature: config.temperature,
            reasoning: config.reasoning ?? "off",
            jsonMode: config.jsonMode,
        };
    }
    async complete(request) {
        const startedAt = performance.now();
        const response = await this.models.completeSimple(this.model, {
            systemPrompt: request.systemPrompt,
            messages: [
                { role: "user", content: request.userPrompt, timestamp: Date.now() },
            ],
        }, {
            temperature: this.config.temperature,
            reasoning: this.config.reasoning,
            maxTokens: request.maxOutputTokens,
            timeoutMs: this.config.timeoutMs,
            maxRetries: this.config.maxRetries,
            ...(this.config.jsonMode
                ? { samplingParams: { response_format: { type: "json_object" } } }
                : {}),
            sessionId: `orgboot-${request.organizationId}-${request.checkpoint}-${request.trialSeed}`,
        });
        if (response.stopReason === "error" || response.stopReason === "aborted") {
            throw new Error(response.errorMessage ?? `Pi model stopped with ${response.stopReason}.`);
        }
        const usage = {
            inputTokens: response.usage.input,
            outputTokens: response.usage.output,
            totalTokens: response.usage.totalTokens,
            latencyMs: performance.now() - startedAt,
            costUsd: response.usage.cost.total,
        };
        const text = contentText(response.content);
        if (text.trim().length === 0) {
            const blockTypes = response.content.map((block) => block.type).join(",") || "none";
            throw new ModelBackendError(`Pi model returned no text content (stopReason=${response.stopReason}, ` +
                `contentBlocks=${blockTypes}, inputTokens=${response.usage.input}, ` +
                `outputTokens=${response.usage.output}).`, usage);
        }
        return {
            text,
            usage,
        };
    }
}
export function createPiTextBackend(config) {
    const models = builtinModels();
    const model = models.getModel(config.provider, config.modelId);
    if (!model) {
        const sample = models
            .getModels(config.provider)
            .slice(0, 8)
            .map((candidate) => candidate.id)
            .join(", ");
        throw new Error(`Unknown Pi model ${config.provider}/${config.modelId}. Available examples: ${sample || "none"}.`);
    }
    return new PiTextBackend(models, model, config);
}
//# sourceMappingURL=pi-backend.js.map