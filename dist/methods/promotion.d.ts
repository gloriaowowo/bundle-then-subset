import type { TaskCase, ToolDefinition, WorkflowArtifact } from "../domain/types.js";
export declare const PROMOTION_GATES: readonly ["direct", "bundle", "safe-subset"];
export type PromotionGate = (typeof PROMOTION_GATES)[number];
export interface PromotionDecision {
    gate: PromotionGate;
    activeWorkflow?: WorkflowArtifact;
    candidateRuleCount: number;
    promotedRuleCount: number;
    droppedRuleCount: number;
    developmentAutomatedPasses: number;
    developmentPolicyFailures: number;
    developmentGroundingFailures: number;
    subsetsEvaluated: number;
    reason: string;
}
export declare function applyPromotionGate(candidate: WorkflowArtifact | undefined, gate: PromotionGate, developmentTasks: readonly TaskCase[], tools: ReadonlyMap<string, ToolDefinition>, evidenceIds: ReadonlySet<string>): PromotionDecision;
