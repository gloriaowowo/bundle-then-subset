import { hashArtifact } from "../eval/manifest.js";
import type { BudgetTracker } from "./budget.js";
import type { FileModelCache } from "./cache.js";
import type {
  JsonCompletionResult,
  ModelUsage,
  TextCompletionRequest,
  TextModelBackend,
} from "./types.js";
import { ModelBackendError } from "./types.js";

const ZERO_USAGE: ModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  latencyMs: 0,
  costUsd: 0,
};

function parseJsonResponse(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new Error(`Model returned invalid JSON: ${(error as Error).message}`);
  }
}

export class JsonModelGateway {
  private logicalCalls = 0;
  private cacheHits = 0;
  private providerCalls = 0;
  private providerInputTokens = 0;
  private providerOutputTokens = 0;
  private providerCostUsd = 0;

  constructor(
    private readonly backend: TextModelBackend,
    private readonly budget: BudgetTracker,
    private readonly cache: FileModelCache,
  ) {}

  async complete(request: TextCompletionRequest): Promise<JsonCompletionResult> {
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
    } catch (error) {
      const usage = error instanceof ModelBackendError ? error.usage : ZERO_USAGE;
      this.recordProviderUsage(usage);
      this.budget.recordCall(
        request.operation,
        request.taskId,
        usage,
      );
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

  stats(): {
    logicalCalls: number;
    cacheHits: number;
    providerCalls: number;
    providerInputTokens: number;
    providerOutputTokens: number;
    providerCostUsd: number;
  } {
    return {
      logicalCalls: this.logicalCalls,
      cacheHits: this.cacheHits,
      providerCalls: this.providerCalls,
      providerInputTokens: this.providerInputTokens,
      providerOutputTokens: this.providerOutputTokens,
      providerCostUsd: this.providerCostUsd,
    };
  }

  private recordProviderUsage(usage: ModelUsage): void {
    this.providerInputTokens += usage.inputTokens;
    this.providerOutputTokens += usage.outputTokens;
    this.providerCostUsd += usage.costUsd;
  }
}
