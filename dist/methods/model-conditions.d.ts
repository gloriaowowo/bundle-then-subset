import type { WorkflowArtifact } from "../domain/types.js";
import type { JsonModelGateway } from "../model/gateway.js";
import { type AdaptationInput, type ConditionId, type ExperimentCondition, type MethodAuditEvent, type MethodState, type MethodTaskResult, type TaskInferenceInput } from "./types.js";
export declare const CLAIM_SYSTEM_PROMPT = "You are an organization-agnostic evidence analyst.\nReturn only the requested JSON. Do not invent organization facts. Every claim\nmust cite visible evidence IDs, preserve scope, and distinguish current from\nsuperseded policy.";
export interface SharedCandidateGeneration {
    candidate?: WorkflowArtifact;
    audit: MethodAuditEvent[];
    attempts: number;
}
/**
 * Generate one candidate independently of its release gate. A second attempt
 * is allowed only to repair a statically invalid artifact, so Direct, Bundle,
 * and Safe-Subset conditions receive the exact same candidate and repair
 * budget. Behavioral verifier feedback is deliberately excluded.
 */
export declare function generateSharedWorkflowCandidate(gateway: JsonModelGateway, input: AdaptationInput, maxStaticAttempts?: number): Promise<SharedCandidateGeneration>;
export declare class RawContextCondition implements ExperimentCondition {
    private readonly gateway;
    readonly id: "C0-raw-context";
    constructor(gateway: JsonModelGateway);
    adapt(input: AdaptationInput): Promise<MethodState>;
    execute(input: TaskInferenceInput): Promise<MethodTaskResult>;
}
export declare class MemoryOnlyCondition implements ExperimentCondition {
    private readonly gateway;
    readonly id: "C1-memory-only";
    constructor(gateway: JsonModelGateway);
    adapt(input: AdaptationInput): Promise<MethodState>;
    execute(input: TaskInferenceInput): Promise<MethodTaskResult>;
}
export declare class DirectWorkflowCondition implements ExperimentCondition {
    private readonly gateway;
    readonly id: "C2-direct-workflow";
    constructor(gateway: JsonModelGateway);
    adapt(input: AdaptationInput): Promise<MethodState>;
    execute(input: TaskInferenceInput): Promise<MethodTaskResult>;
}
export interface OrgBootOptions {
    temporalProvenance: boolean;
    externalPromotion: boolean;
    organizationModel?: boolean;
}
export declare class OrgBootCondition implements ExperimentCondition {
    private readonly gateway;
    private readonly options;
    readonly id: ConditionId;
    constructor(gateway: JsonModelGateway, options?: OrgBootOptions);
    adapt(input: AdaptationInput): Promise<MethodState>;
    execute(input: TaskInferenceInput): Promise<MethodTaskResult>;
    private promoteIfSafe;
}
