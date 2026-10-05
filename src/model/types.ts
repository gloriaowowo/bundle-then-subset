export type ModelOperation = "adaptation" | "task_inference";

export interface ModelDescriptor {
  provider: string;
  id: string;
  temperature: number;
  reasoning?: string;
  jsonMode?: boolean;
}

export interface TextCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  operation: ModelOperation;
  organizationId: string;
  checkpoint: number;
  taskId?: string;
  trialSeed: number;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  costUsd: number;
}

/** Provider failures may still be billable and must reach the budget ledger. */
export class ModelBackendError extends Error {
  constructor(
    message: string,
    readonly usage: ModelUsage,
  ) {
    super(message);
    this.name = "ModelBackendError";
  }
}

export interface TextCompletionResponse {
  text: string;
  usage: ModelUsage;
}

export interface TextModelBackend {
  readonly descriptor: ModelDescriptor;
  complete(request: TextCompletionRequest): Promise<TextCompletionResponse>;
}

export interface JsonCompletionResult {
  value: unknown;
  rawText: string;
  requestHash: string;
  usage: ModelUsage;
  cacheHit: boolean;
}
