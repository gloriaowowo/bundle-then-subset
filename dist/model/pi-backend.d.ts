import { type Api, type Model, type Models, type ThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelDescriptor, TextCompletionRequest, TextCompletionResponse, TextModelBackend } from "./types.js";
export interface PiBackendConfig {
    provider: string;
    modelId: string;
    temperature: number;
    jsonMode: boolean;
    reasoning?: ThinkingLevel;
    timeoutMs: number;
    maxRetries: number;
}
export declare class PiTextBackend implements TextModelBackend {
    private readonly models;
    private readonly model;
    private readonly config;
    readonly descriptor: ModelDescriptor;
    constructor(models: Models, model: Model<Api>, config: PiBackendConfig);
    complete(request: TextCompletionRequest): Promise<TextCompletionResponse>;
}
export declare function createPiTextBackend(config: PiBackendConfig): PiTextBackend;
