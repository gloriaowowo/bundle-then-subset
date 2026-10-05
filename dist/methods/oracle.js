import { executeWorkflow } from "../simulator/workflow.js";
import { emptyMethodState, } from "./types.js";
export class OracleCondition {
    workflow;
    id = "C4-oracle";
    constructor(workflow) {
        this.workflow = workflow;
    }
    async adapt(input) {
        if (input.organizationId !== this.workflow.organizationId) {
            throw new Error("Oracle workflow belongs to a different organization.");
        }
        const state = emptyMethodState(this.id, input.organizationId, input.checkpoint);
        state.activeWorkflows.push(structuredClone(this.workflow));
        return state;
    }
    async execute(input) {
        const workflow = input.state.activeWorkflows.find((candidate) => candidate.taskFamily === input.task.family);
        if (!workflow) {
            throw new Error(`No oracle workflow for task family ${input.task.family}.`);
        }
        return {
            execution: executeWorkflow(workflow, input.task, input.tools),
            groundingWorkflow: workflow,
        };
    }
}
//# sourceMappingURL=oracle.js.map