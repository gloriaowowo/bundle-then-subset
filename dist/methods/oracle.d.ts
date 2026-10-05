import type { WorkflowArtifact } from "../domain/types.js";
import { type AdaptationInput, type ExperimentCondition, type MethodState, type MethodTaskResult, type TaskInferenceInput } from "./types.js";
export declare class OracleCondition implements ExperimentCondition {
    private readonly workflow;
    readonly id: "C4-oracle";
    constructor(workflow: WorkflowArtifact);
    adapt(input: AdaptationInput): Promise<MethodState>;
    execute(input: TaskInferenceInput): Promise<MethodTaskResult>;
}
