import type {
  EvidenceItem,
  OrganizationClaim,
  WorkflowArtifact,
} from "../domain/types.js";
import { gradeTrace } from "../eval/grader.js";
import type { JsonModelGateway } from "../model/gateway.js";
import {
  executeWorkflow,
  parseWorkflowArtifact,
} from "../simulator/workflow.js";
import {
  fallbackAbstentionWorkflow,
  parseOrganizationClaims,
} from "./artifacts.js";
import {
  claimInductionPrompt,
  directWorkflowInductionPrompt,
  memoryTaskPrompt,
  rawContextTaskPrompt,
  WORKFLOW_SYSTEM_PROMPT,
} from "./prompts.js";
import {
  emptyMethodState,
  type AdaptationInput,
  type ConditionId,
  type ExperimentCondition,
  type MethodAuditEvent,
  type MethodState,
  type MethodTaskResult,
  type TaskInferenceInput,
} from "./types.js";

export const CLAIM_SYSTEM_PROMPT = `You are an organization-agnostic evidence analyst.
Return only the requested JSON. Do not invent organization facts. Every claim
must cite visible evidence IDs, preserve scope, and distinguish current from
superseded policy.`;

function addAudit(
  state: MethodState,
  kind: MethodState["audit"][number]["kind"],
  artifactId?: string,
  reason?: string,
): void {
  state.audit.push({
    sequence: state.audit.length,
    kind,
    ...(artifactId ? { artifactId } : {}),
    ...(reason ? { reason } : {}),
  });
}

function checkWorkflowIdentity(
  workflow: WorkflowArtifact,
  organizationId: string,
  taskFamily: string,
): void {
  if (workflow.organizationId !== organizationId) {
    throw new Error(`Workflow organization ${workflow.organizationId} does not match ${organizationId}.`);
  }
  if (workflow.taskFamily !== taskFamily) {
    throw new Error(`Workflow family ${workflow.taskFamily} does not match ${taskFamily}.`);
  }
}

async function induceClaims(
  gateway: JsonModelGateway,
  input: AdaptationInput,
  evidence: readonly EvidenceItem[],
  state: MethodState,
): Promise<OrganizationClaim[]> {
  const taskFamily = input.developmentTasks[0]?.family;
  if (!taskFamily) {
    throw new Error("Claim induction requires a development task family.");
  }
  const response = await gateway.complete({
    systemPrompt: CLAIM_SYSTEM_PROMPT,
    userPrompt: claimInductionPrompt(
      input.organizationId,
      taskFamily,
      input.developmentTasks,
      evidence,
    ),
    maxOutputTokens: 4096,
    operation: "adaptation",
    organizationId: input.organizationId,
    checkpoint: input.checkpoint,
    trialSeed: input.trialSeed,
  });
  addAudit(state, "model_call", response.requestHash);
  const claims = parseOrganizationClaims(
    response.value,
    new Set(input.visibleEvidence.map((item) => item.id)),
  );
  for (const claim of claims) {
    addAudit(state, "claim_proposed", claim.id);
  }
  return claims;
}

async function induceReusableWorkflow(
  gateway: JsonModelGateway,
  input: AdaptationInput,
  evidence: readonly EvidenceItem[],
  claims: readonly OrganizationClaim[],
  state: MethodState,
  revision?: {
    previousCandidate?: unknown;
    aggregateFeedback: Record<string, number>;
  },
): Promise<WorkflowArtifact> {
  const taskFamily = input.developmentTasks[0]?.family;
  if (!taskFamily) {
    throw new Error("Workflow induction requires a development task family.");
  }
  const response = await gateway.complete({
    systemPrompt: WORKFLOW_SYSTEM_PROMPT,
    userPrompt: directWorkflowInductionPrompt(
      input.organizationId,
      taskFamily,
      input.developmentTasks,
      evidence,
      input.tools,
      claims,
      revision,
    ),
    // Reasoning and final JSON share this ceiling on DeepSeek-compatible
    // endpoints. A 3,200-token ceiling produced a reasoning-only response with
    // no final text in the first development pilot, so reserve enough room for
    // both phases while remaining far below the run-level token/cost limits.
    maxOutputTokens: 8192,
    operation: "adaptation",
    organizationId: input.organizationId,
    checkpoint: input.checkpoint,
    trialSeed: input.trialSeed,
  });
  addAudit(state, "model_call", response.requestHash);
  const workflow = parseWorkflowArtifact(
    response.value,
    input.tools,
    new Set(input.visibleEvidence.map((item) => item.id)),
  );
  checkWorkflowIdentity(workflow, input.organizationId, taskFamily);
  addAudit(state, "workflow_proposed", workflow.id);
  return workflow;
}

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
export async function generateSharedWorkflowCandidate(
  gateway: JsonModelGateway,
  input: AdaptationInput,
  maxStaticAttempts = 2,
): Promise<SharedCandidateGeneration> {
  const state = emptyMethodState("C2-direct-workflow", input.organizationId, input.checkpoint);
  if (input.visibleEvidence.length === 0) {
    return { audit: state.audit, attempts: 0 };
  }
  let revision:
    | {
        aggregateFeedback: Record<string, number>;
      }
    | undefined;
  for (let attempt = 0; attempt < maxStaticAttempts; attempt += 1) {
    try {
      const candidate = await induceReusableWorkflow(
        gateway,
        input,
        input.visibleEvidence,
        [],
        state,
        revision,
      );
      state.candidateWorkflows.push(candidate);
      return { candidate, audit: state.audit, attempts: attempt + 1 };
    } catch (error) {
      addAudit(state, "workflow_rejected", undefined, (error as Error).message);
      revision = {
        aggregateFeedback: {
          staticValidationFailures: 1,
          functionalFailures: 0,
          policyFailures: 0,
          groundingFailures: 0,
        },
      };
    }
  }
  return { audit: state.audit, attempts: maxStaticAttempts };
}

async function inferTaskWorkflow(
  gateway: JsonModelGateway,
  input: TaskInferenceInput,
  prompt: string,
): Promise<WorkflowArtifact> {
  const response = await gateway.complete({
    systemPrompt: WORKFLOW_SYSTEM_PROMPT,
    userPrompt: prompt,
    maxOutputTokens: 2400,
    operation: "task_inference",
    organizationId: input.task.organizationId,
    checkpoint: input.state.checkpoint,
    taskId: input.task.id,
    trialSeed: input.trialSeed,
  });
  addAudit(input.state, "model_call", response.requestHash);
  const workflow = parseWorkflowArtifact(
    response.value,
    input.tools,
    new Set(input.visibleEvidence.map((item) => item.id)),
  );
  checkWorkflowIdentity(workflow, input.task.organizationId, input.task.family);
  return workflow;
}

function executeOrAbstain(
  workflow: WorkflowArtifact | undefined,
  input: TaskInferenceInput,
  suffix: string,
): MethodTaskResult {
  const selected =
    workflow ??
    fallbackAbstentionWorkflow(input.task, input.visibleEvidence, suffix);
  return {
    execution: executeWorkflow(selected, input.task, input.tools),
    groundingWorkflow: selected,
  };
}

export class RawContextCondition implements ExperimentCondition {
  readonly id = "C0-raw-context" as const;

  constructor(private readonly gateway: JsonModelGateway) {}

  async adapt(input: AdaptationInput): Promise<MethodState> {
    return emptyMethodState(this.id, input.organizationId, input.checkpoint);
  }

  async execute(input: TaskInferenceInput): Promise<MethodTaskResult> {
    try {
      const workflow = await inferTaskWorkflow(
        this.gateway,
        input,
        rawContextTaskPrompt(input.task, input.visibleEvidence, input.tools),
      );
      return executeOrAbstain(workflow, input, "raw-context");
    } catch (error) {
      addAudit(input.state, "workflow_rejected", undefined, (error as Error).message);
      return executeOrAbstain(undefined, input, "raw-context");
    }
  }
}

export class MemoryOnlyCondition implements ExperimentCondition {
  readonly id = "C1-memory-only" as const;

  constructor(private readonly gateway: JsonModelGateway) {}

  async adapt(input: AdaptationInput): Promise<MethodState> {
    const state = emptyMethodState(this.id, input.organizationId, input.checkpoint);
    if (input.visibleEvidence.length === 0) {
      return state;
    }
    try {
      state.claims = await induceClaims(this.gateway, input, input.visibleEvidence, state);
    } catch (error) {
      addAudit(state, "workflow_rejected", undefined, `claim induction failed: ${(error as Error).message}`);
    }
    return state;
  }

  async execute(input: TaskInferenceInput): Promise<MethodTaskResult> {
    try {
      const activeClaims = input.state.claims.filter((claim) => claim.status === "active");
      const workflow = await inferTaskWorkflow(
        this.gateway,
        input,
        memoryTaskPrompt(input.task, activeClaims, input.tools),
      );
      return executeOrAbstain(workflow, input, "memory-only");
    } catch (error) {
      addAudit(input.state, "workflow_rejected", undefined, (error as Error).message);
      return executeOrAbstain(undefined, input, "memory-only");
    }
  }
}

export class DirectWorkflowCondition implements ExperimentCondition {
  readonly id = "C2-direct-workflow" as const;

  constructor(private readonly gateway: JsonModelGateway) {}

  async adapt(input: AdaptationInput): Promise<MethodState> {
    const state = emptyMethodState(this.id, input.organizationId, input.checkpoint);
    if (input.visibleEvidence.length === 0) {
      return state;
    }
    try {
      const candidate = await induceReusableWorkflow(
        this.gateway,
        input,
        input.visibleEvidence,
        [],
        state,
      );
      state.candidateWorkflows.push(candidate);
      const active = structuredClone(candidate);
      active.status = "active";
      state.activeWorkflows.push(active);
      addAudit(state, "workflow_promoted", active.id, "Direct baseline activates every statically valid workflow.");
    } catch (error) {
      addAudit(state, "workflow_rejected", undefined, (error as Error).message);
    }
    return state;
  }

  async execute(input: TaskInferenceInput): Promise<MethodTaskResult> {
    const workflow = input.state.activeWorkflows.find(
      (candidate) => candidate.taskFamily === input.task.family,
    );
    return executeOrAbstain(workflow, input, "direct-workflow");
  }
}

export interface OrgBootOptions {
  temporalProvenance: boolean;
  externalPromotion: boolean;
  organizationModel?: boolean;
}

export class OrgBootCondition implements ExperimentCondition {
  readonly id: ConditionId;

  constructor(
    private readonly gateway: JsonModelGateway,
    private readonly options: OrgBootOptions = {
      temporalProvenance: true,
      externalPromotion: true,
      organizationModel: false,
    },
  ) {
    this.id = !options.externalPromotion
      ? "C3-no-promotion"
      : options.organizationModel === true
        ? !options.temporalProvenance
          ? "C3-no-temporal-provenance"
          : "C3-with-organization-model"
        : "C3-orgboot";
  }

  async adapt(input: AdaptationInput): Promise<MethodState> {
    const state = emptyMethodState(this.id, input.organizationId, input.checkpoint);
    if (input.visibleEvidence.length === 0) {
      return state;
    }
    const inductionEvidence = this.options.temporalProvenance
      ? input.visibleEvidence
      : input.visibleEvidence.map((item) => ({
          ...item,
          sequence: 1,
          observedAt: "unspecified",
          authority: "employee" as const,
        }));
    try {
      state.claims = this.options.organizationModel === true
        ? await induceClaims(this.gateway, input, inductionEvidence, state)
        : [];
      const activeClaims = state.claims.filter((claim) => claim.status === "active");
      let revision:
        | {
            previousCandidate?: unknown;
            aggregateFeedback: Record<string, number>;
          }
        | undefined;
      const attempts = this.options.externalPromotion ? 2 : 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        let candidate: WorkflowArtifact;
        try {
          candidate = await induceReusableWorkflow(
            this.gateway,
            input,
            inductionEvidence,
            activeClaims,
            state,
            revision,
          );
        } catch (error) {
          const reason = (error as Error).message;
          addAudit(state, "workflow_rejected", undefined, reason);
          revision = {
            aggregateFeedback: {
              staticValidationFailures: 1,
              functionalFailures: 0,
              policyFailures: 0,
              groundingFailures: 0,
            },
          };
          continue;
        }
        state.candidateWorkflows.push(candidate);
        if (!this.options.externalPromotion) {
          const active = structuredClone(candidate);
          active.status = "active";
          state.activeWorkflows.push(active);
          addAudit(state, "workflow_promoted", active.id, "Promotion ablation activates statically valid candidates.");
          return state;
        }
        const promotion = this.promoteIfSafe(candidate, state, input);
        if (promotion.promoted) {
          return state;
        }
        revision = {
          previousCandidate: candidate,
          aggregateFeedback: promotion.feedback,
        };
      }
    } catch (error) {
      addAudit(state, "workflow_rejected", undefined, (error as Error).message);
    }
    return state;
  }

  async execute(input: TaskInferenceInput): Promise<MethodTaskResult> {
    const workflow = input.state.activeWorkflows.find(
      (candidate) => candidate.taskFamily === input.task.family,
    );
    return executeOrAbstain(workflow, input, "orgboot");
  }

  private promoteIfSafe(
    candidate: WorkflowArtifact,
    state: MethodState,
    input: AdaptationInput,
  ): { promoted: boolean; feedback: Record<string, number> } {
    const evidenceIds = new Set(input.visibleEvidence.map((item) => item.id));
    const gradeWorkflow = (workflow: WorkflowArtifact) =>
      input.developmentTasks.map((task) => {
        const execution = executeWorkflow(workflow, task, input.tools);
        return gradeTrace(
          task,
          execution.trace,
          execution.finalState,
          workflow,
          evidenceIds,
        );
      });
    const grades = gradeWorkflow(candidate);
    const policySafe = grades.every((grade) => grade.policyPass);
    const groundingSafe = grades.every((grade) => grade.groundingPass);
    const useful = grades.some((grade) => grade.automatedPass);
    const feedback = {
      staticValidationFailures: 0,
      functionalFailures: grades.filter((grade) => !grade.functionalPass).length,
      policyFailures: grades.filter((grade) => !grade.policyPass).length,
      groundingFailures: grades.filter((grade) => !grade.groundingPass).length,
      automatedPasses: grades.filter((grade) => grade.automatedPass).length,
      promotedRules: 0,
      droppedRules: 0,
    };

    let promotable = candidate;
    let promotedGrades = grades;
    if (!policySafe || !groundingSafe) {
      // At most eight rules are allowed, so the controller can exactly search
      // all non-empty, order-preserving subsets (<=255) instead of relying on a
      // rule-order-sensitive greedy choice. Maximize verified development
      // coverage subject to zero policy/grounding failures; ties prefer the
      // smaller capability surface.
      let bestRules: WorkflowArtifact["rules"] = [];
      let bestPasses = 0;
      const subsetCount = 2 ** candidate.rules.length;
      for (let mask = 1; mask < subsetCount; mask += 1) {
        const subset = candidate.rules.filter((_, index) => (mask & (1 << index)) !== 0);
        const trial = structuredClone(candidate);
        trial.rules = structuredClone(subset);
        const trialGrades = gradeWorkflow(trial);
        const trialSafe = trialGrades.every(
          (grade) => grade.policyPass && grade.groundingPass,
        );
        if (!trialSafe) continue;
        const trialPasses = trialGrades.filter((grade) => grade.automatedPass).length;
        if (
          trialPasses > bestPasses ||
          (trialPasses === bestPasses && trialPasses > 0 && subset.length < bestRules.length)
        ) {
          bestRules = structuredClone(subset);
          bestPasses = trialPasses;
          promotedGrades = trialGrades;
        }
      }
      feedback.promotedRules = bestRules.length;
      feedback.droppedRules = candidate.rules.length - bestRules.length;
      if (bestRules.length > 0) {
        promotable = structuredClone(candidate);
        promotable.rules = bestRules;
      }
    } else {
      feedback.promotedRules = candidate.rules.length;
    }

    const promotedPolicySafe = promotedGrades.every((grade) => grade.policyPass);
    const promotedGroundingSafe = promotedGrades.every((grade) => grade.groundingPass);
    const promotedPasses = promotedGrades.filter((grade) => grade.automatedPass).length;
    if (!promotedPolicySafe || !promotedGroundingSafe || promotedPasses === 0) {
      addAudit(
        state,
        "workflow_rejected",
        candidate.id,
        `promotion failed: policySafe=${policySafe}, groundingSafe=${groundingSafe}, ` +
          `automatedPasses=${feedback.automatedPasses}, safeRules=${feedback.promotedRules}`,
      );
      return { promoted: false, feedback };
    }
    const active = structuredClone(promotable);
    active.status = "active";
    state.activeWorkflows.push(active);
    addAudit(
      state,
      "workflow_promoted",
      active.id,
      `promotion activated ${active.rules.length}/${candidate.rules.length} safe rules; ` +
        `passed ${promotedPasses}/${promotedGrades.length} development cases`,
    );
    return { promoted: true, feedback };
  }
}
