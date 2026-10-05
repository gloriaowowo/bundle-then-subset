import type { WorkflowArtifact } from "../domain/types.js";
import { executeWorkflow } from "../simulator/workflow.js";
import {
  emptyMethodState,
  type AdaptationInput,
  type ExperimentCondition,
  type MethodState,
  type MethodTaskResult,
  type TaskInferenceInput,
} from "./types.js";

export class OracleCondition implements ExperimentCondition {
  readonly id = "C4-oracle" as const;

  constructor(private readonly workflow: WorkflowArtifact) {}

  async adapt(input: AdaptationInput): Promise<MethodState> {
    if (input.organizationId !== this.workflow.organizationId) {
      throw new Error("Oracle workflow belongs to a different organization.");
    }
    const state = emptyMethodState(this.id, input.organizationId, input.checkpoint);
    state.activeWorkflows.push(structuredClone(this.workflow));
    return state;
  }

  async execute(input: TaskInferenceInput): Promise<MethodTaskResult> {
    const workflow = input.state.activeWorkflows.find(
      (candidate) => candidate.taskFamily === input.task.family,
    );
    if (!workflow) {
      throw new Error(`No oracle workflow for task family ${input.task.family}.`);
    }
    return {
      execution: executeWorkflow(workflow, input.task, input.tools),
      groundingWorkflow: workflow,
    };
  }
}
