import type { EvidenceItem, ExecutionResult, OrganizationClaim, TaskCase, ToolDefinition, WorkflowArtifact } from "../domain/types.js";
export type ConditionId = "C0-raw-context" | "C1-memory-only" | "C2-direct-workflow" | "C3-orgboot" | "C3-with-organization-model" | "C3-no-organization-model" | "C3-no-temporal-provenance" | "C3-no-promotion" | "C4-oracle";
export interface MethodAuditEvent {
    sequence: number;
    kind: "model_call" | "claim_proposed" | "workflow_proposed" | "workflow_promoted" | "workflow_rejected" | "workflow_rolled_back";
    artifactId?: string;
    reason?: string;
}
export interface MethodState {
    conditionId: ConditionId;
    organizationId: string;
    checkpoint: number;
    claims: OrganizationClaim[];
    candidateWorkflows: WorkflowArtifact[];
    activeWorkflows: WorkflowArtifact[];
    audit: MethodAuditEvent[];
}
export interface AdaptationInput {
    organizationId: string;
    domain: "support" | "procurement";
    checkpoint: number;
    visibleEvidence: readonly EvidenceItem[];
    developmentTasks: readonly TaskCase[];
    tools: ReadonlyMap<string, ToolDefinition>;
    trialSeed: number;
}
export interface TaskInferenceInput {
    task: TaskCase;
    visibleEvidence: readonly EvidenceItem[];
    tools: ReadonlyMap<string, ToolDefinition>;
    state: MethodState;
    trialSeed: number;
}
export interface MethodTaskResult {
    execution: ExecutionResult;
    groundingWorkflow: WorkflowArtifact;
}
export interface ExperimentCondition {
    readonly id: ConditionId;
    adapt(input: AdaptationInput): Promise<MethodState>;
    execute(input: TaskInferenceInput): Promise<MethodTaskResult>;
}
export declare function emptyMethodState(conditionId: ConditionId, organizationId: string, checkpoint: number): MethodState;
