import type { ExecutionResult, JsonValue, TaskCase, ToolDefinition, WorkflowArtifact } from "../domain/types.js";
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
export declare function validateWorkflow(workflow: WorkflowArtifact, tools: ReadonlyMap<string, ToolDefinition>, knownEvidence: ReadonlySet<string>, maxSteps?: number): ValidationResult;
export declare function parseWorkflowArtifact(value: unknown, tools: ReadonlyMap<string, ToolDefinition>, knownEvidence: ReadonlySet<string>, maxSteps?: number): WorkflowArtifact;
export declare function executeWorkflow(workflow: WorkflowArtifact, task: TaskCase, tools: ReadonlyMap<string, ToolDefinition>, claims?: Record<string, JsonValue>): ExecutionResult;
