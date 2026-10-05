import type {
  ActionTrace,
  ExecutionResult,
  JsonValue,
  TaskCase,
  ToolDefinition,
  TraceEvent,
  WorkflowArtifact,
  WorkflowStep,
  WorldState,
} from "../domain/types.js";
import {
  evaluateExpression,
  resolveArgs,
  type EvaluationContext,
} from "./expression.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

type WithoutSequence<T> = T extends unknown ? Omit<T, "sequence"> : never;
type UnsequencedTraceEvent = WithoutSequence<TraceEvent>;

function cloneState(state: WorldState): WorldState {
  return structuredClone(state);
}

function collectToolSteps(workflow: WorkflowArtifact): WorkflowStep[] {
  return workflow.rules.flatMap((rule) => [
    ...rule.steps,
    ...(rule.otherwise ?? []),
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnexpectedKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: string,
  errors: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(`${location} contains unsupported field ${key}`);
    }
  }
}

function validateValueExpressionShape(
  value: unknown,
  location: string,
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push(`${location} must be an object`);
    return;
  }
  if (value.kind === "literal") {
    rejectUnexpectedKeys(value, new Set(["kind", "value"]), location, errors);
    if (!("value" in value)) {
      errors.push(`${location} literal is missing value`);
    }
    return;
  }
  if (value.kind === "path") {
    rejectUnexpectedKeys(value, new Set(["kind", "path"]), location, errors);
    if (typeof value.path !== "string" || value.path.length === 0) {
      errors.push(`${location} path must be a non-empty string`);
    }
    return;
  }
  errors.push(`${location} has unsupported value-expression kind`);
}

function validateExpressionShape(
  value: unknown,
  location: string,
  errors: string[],
  depth = 0,
): void {
  if (depth > 8) {
    errors.push(`${location} exceeds maximum expression depth`);
    return;
  }
  if (!isRecord(value) || typeof value.op !== "string") {
    errors.push(`${location} must be an expression object`);
    return;
  }
  if (value.op === "all" || value.op === "any") {
    rejectUnexpectedKeys(value, new Set(["op", "args"]), location, errors);
    if (!Array.isArray(value.args) || value.args.length === 0) {
      errors.push(`${location}.${value.op} requires a non-empty args array`);
      return;
    }
    value.args.forEach((item, index) =>
      validateExpressionShape(item, `${location}.args[${index}]`, errors, depth + 1),
    );
    return;
  }
  if (value.op === "not") {
    rejectUnexpectedKeys(value, new Set(["op", "arg"]), location, errors);
    validateExpressionShape(value.arg, `${location}.arg`, errors, depth + 1);
    return;
  }
  const comparisonOps = new Set([
    "eq",
    "neq",
    "lt",
    "lte",
    "gt",
    "gte",
    "in",
    "exists",
  ]);
  if (!comparisonOps.has(value.op)) {
    errors.push(`${location} has unsupported operator ${value.op}`);
    return;
  }
  rejectUnexpectedKeys(value, new Set(["op", "left", "right"]), location, errors);
  validateValueExpressionShape(value.left, `${location}.left`, errors);
  if (value.op === "exists") {
    if (value.right !== undefined) {
      errors.push(`${location}.exists cannot include right`);
    }
  } else if (value.right === undefined) {
    errors.push(`${location}.${value.op} requires right`);
  } else {
    validateValueExpressionShape(value.right, `${location}.right`, errors);
  }
}

function validateStepShape(
  value: unknown,
  location: string,
  errors: string[],
): void {
  if (!isRecord(value) || typeof value.kind !== "string") {
    errors.push(`${location} must be a workflow-step object`);
    return;
  }
  switch (value.kind) {
    case "tool": {
      rejectUnexpectedKeys(value, new Set(["kind", "tool", "args"]), location, errors);
      if (typeof value.tool !== "string" || value.tool.length === 0) {
        errors.push(`${location}.tool must be a non-empty string`);
      }
      if (!isRecord(value.args)) {
        errors.push(`${location}.args must be an object`);
        return;
      }
      for (const [key, argument] of Object.entries(value.args)) {
        validateValueExpressionShape(argument, `${location}.args.${key}`, errors);
      }
      return;
    }
    case "require_approval":
      rejectUnexpectedKeys(value, new Set(["kind", "role", "reason"]), location, errors);
      if (typeof value.role !== "string" || value.role.length === 0) {
        errors.push(`${location}.role must be a non-empty string`);
      }
      if (typeof value.reason !== "string" || value.reason.length === 0) {
        errors.push(`${location}.reason must be a non-empty string`);
      }
      return;
    case "escalate":
      rejectUnexpectedKeys(value, new Set(["kind", "queue", "reason"]), location, errors);
      if (typeof value.queue !== "string" || value.queue.length === 0) {
        errors.push(`${location}.queue must be a non-empty string`);
      }
      if (typeof value.reason !== "string" || value.reason.length === 0) {
        errors.push(`${location}.reason must be a non-empty string`);
      }
      return;
    case "respond": {
      rejectUnexpectedKeys(value, new Set(["kind", "code", "fields"]), location, errors);
      if (typeof value.code !== "string" || value.code.length === 0) {
        errors.push(`${location}.code must be a non-empty string`);
      }
      if (!isRecord(value.fields)) {
        errors.push(`${location}.fields must be an object`);
        return;
      }
      for (const [key, field] of Object.entries(value.fields)) {
        validateValueExpressionShape(field, `${location}.fields.${key}`, errors);
      }
      return;
    }
    case "abstain":
      rejectUnexpectedKeys(value, new Set(["kind", "reason"]), location, errors);
      if (typeof value.reason !== "string" || value.reason.length === 0) {
        errors.push(`${location}.reason must be a non-empty string`);
      }
      return;
    default:
      errors.push(`${location} has unsupported step kind ${value.kind}`);
  }
}

function validateRuntimeShape(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("workflow must be an object");
    return;
  }
  rejectUnexpectedKeys(
    value,
    new Set([
      "id",
      "organizationId",
      "taskFamily",
      "version",
      "trigger",
      "rules",
      "provenance",
      "status",
    ]),
    "workflow",
    errors,
  );
  for (const key of ["id", "organizationId", "taskFamily"] as const) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      errors.push(`workflow.${key} must be a non-empty string`);
    }
  }
  if (!Number.isInteger(value.version) || (value.version as number) < 1) {
    errors.push("workflow.version must be a positive integer");
  }
  if (!new Set(["candidate", "active", "rejected", "rolled_back"]).has(String(value.status))) {
    errors.push("workflow.status is unsupported");
  }
  validateExpressionShape(value.trigger, "workflow.trigger", errors);
  if (!Array.isArray(value.provenance) || value.provenance.some((item) => typeof item !== "string")) {
    errors.push("workflow.provenance must be a string array");
  }
  if (!Array.isArray(value.rules)) {
    errors.push("workflow.rules must be an array");
    return;
  }
  value.rules.forEach((rawRule, ruleIndex) => {
    const location = `workflow.rules[${ruleIndex}]`;
    if (!isRecord(rawRule)) {
      errors.push(`${location} must be an object`);
      return;
    }
    rejectUnexpectedKeys(
      rawRule,
      new Set(["id", "when", "steps", "otherwise", "provenance"]),
      location,
      errors,
    );
    if (typeof rawRule.id !== "string" || rawRule.id.length === 0) {
      errors.push(`${location}.id must be a non-empty string`);
    }
    validateExpressionShape(rawRule.when, `${location}.when`, errors);
    if (!Array.isArray(rawRule.provenance) || rawRule.provenance.some((item) => typeof item !== "string")) {
      errors.push(`${location}.provenance must be a string array`);
    }
    if (!Array.isArray(rawRule.steps)) {
      errors.push(`${location}.steps must be an array`);
    } else {
      rawRule.steps.forEach((step, stepIndex) =>
        validateStepShape(step, `${location}.steps[${stepIndex}]`, errors),
      );
    }
    if (rawRule.otherwise !== undefined) {
      if (!Array.isArray(rawRule.otherwise)) {
        errors.push(`${location}.otherwise must be an array`);
      } else {
        rawRule.otherwise.forEach((step, stepIndex) =>
          validateStepShape(step, `${location}.otherwise[${stepIndex}]`, errors),
        );
      }
    }
  });
}

export function validateWorkflow(
  workflow: WorkflowArtifact,
  tools: ReadonlyMap<string, ToolDefinition>,
  knownEvidence: ReadonlySet<string>,
  maxSteps = 8,
): ValidationResult {
  const errors: string[] = [];
  validateRuntimeShape(workflow as unknown, errors);
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  const ruleIds = new Set<string>();
  let stepCount = 0;

  if (workflow.rules.length === 0) {
    errors.push("workflow has no rules");
  }
  if (workflow.rules.length > 8) {
    errors.push(`workflow has ${workflow.rules.length} rules; maximum is 8`);
  }

  for (const rule of workflow.rules) {
    if (ruleIds.has(rule.id)) {
      errors.push(`duplicate rule id: ${rule.id}`);
    }
    ruleIds.add(rule.id);
    if (rule.steps.length === 0) {
      errors.push(`rule ${rule.id} has no steps`);
    }
    stepCount += rule.steps.length + (rule.otherwise?.length ?? 0);

    if (rule.provenance.length === 0) {
      errors.push(`rule ${rule.id} has no provenance`);
    }
    for (const evidenceId of rule.provenance) {
      if (!knownEvidence.has(evidenceId)) {
        errors.push(`rule ${rule.id} cites unknown evidence ${evidenceId}`);
      }
    }
  }

  for (const evidenceId of workflow.provenance) {
    if (!knownEvidence.has(evidenceId)) {
      errors.push(`workflow cites unknown evidence ${evidenceId}`);
    }
  }

  if (stepCount > maxSteps) {
    errors.push(`workflow has ${stepCount} steps; maximum is ${maxSteps}`);
  }

  for (const step of collectToolSteps(workflow)) {
    if (step.kind === "tool" && !tools.has(step.tool)) {
      errors.push(`workflow calls unknown tool ${step.tool}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function parseWorkflowArtifact(
  value: unknown,
  tools: ReadonlyMap<string, ToolDefinition>,
  knownEvidence: ReadonlySet<string>,
  maxSteps = 8,
): WorkflowArtifact {
  const validation = validateWorkflow(
    value as WorkflowArtifact,
    tools,
    knownEvidence,
    maxSteps,
  );
  if (!validation.valid) {
    throw new Error(`Invalid workflow artifact: ${validation.errors.join("; ")}`);
  }
  return structuredClone(value as WorkflowArtifact);
}

function pushEvent(
  events: TraceEvent[],
  event: UnsequencedTraceEvent,
): void {
  events.push({ ...event, sequence: events.length } as TraceEvent);
}

export function executeWorkflow(
  workflow: WorkflowArtifact,
  task: TaskCase,
  tools: ReadonlyMap<string, ToolDefinition>,
  claims: Record<string, JsonValue> = {},
): ExecutionResult {
  let state = cloneState(task.initialState);
  const events: TraceEvent[] = [];
  const baseContext = (): EvaluationContext => ({
    input: task.input,
    state,
    claims,
    events,
    actorRole: task.actorRole,
  });

  if (!evaluateExpression(workflow.trigger, baseContext())) {
    pushEvent(events, {
      kind: "abstention",
      reason: "workflow trigger did not match",
    });
    return finish(workflow, task, events, state);
  }

  const rule = workflow.rules.find((candidate) =>
    evaluateExpression(candidate.when, baseContext()),
  );

  if (!rule) {
    pushEvent(events, {
      kind: "abstention",
      reason: "no workflow rule matched",
    });
    return finish(workflow, task, events, state);
  }

  for (const step of rule.steps) {
    const shouldStop = executeStep(
      step,
      task,
      tools,
      claims,
      events,
      () => state,
      (nextState) => {
        state = nextState;
      },
    );
    if (shouldStop) {
      break;
    }
  }

  return {
    ...finish(workflow, task, events, state),
    matchedRuleId: rule.id,
  };
}

function executeStep(
  step: WorkflowStep,
  task: TaskCase,
  tools: ReadonlyMap<string, ToolDefinition>,
  claims: Record<string, JsonValue>,
  events: TraceEvent[],
  getState: () => WorldState,
  setState: (state: WorldState) => void,
): boolean {
  const context = (): EvaluationContext => ({
    input: task.input,
    state: getState(),
    claims,
    events,
    actorRole: task.actorRole,
  });

  switch (step.kind) {
    case "tool": {
      const tool = tools.get(step.tool);
      if (!tool) {
        throw new Error(`Unknown tool: ${step.tool}`);
      }
      const args = resolveArgs(step.args, context());
      const result = tool.execute(args, {
        actorRole: task.actorRole,
        taskInput: task.input,
        state: getState(),
      });
      setState(result.state);
      pushEvent(events, {
        kind: "tool",
        tool: tool.name,
        args,
        mutates: tool.mutates,
      });
      return false;
    }
    case "require_approval":
      pushEvent(events, {
        kind: "approval",
        role: step.role,
        reason: step.reason,
      });
      return true;
    case "escalate":
      pushEvent(events, {
        kind: "escalation",
        queue: step.queue,
        reason: step.reason,
      });
      return true;
    case "respond":
      pushEvent(events, {
        kind: "response",
        code: step.code,
        fields: resolveArgs(step.fields, context()),
      });
      return true;
    case "abstain":
      pushEvent(events, { kind: "abstention", reason: step.reason });
      return true;
  }
}

function finish(
  workflow: WorkflowArtifact,
  task: TaskCase,
  events: TraceEvent[],
  state: WorldState,
): ExecutionResult {
  const trace: ActionTrace = {
    taskId: task.id,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    events,
    citedClaims: [],
    citedEvidence: workflow.provenance,
  };
  return { trace, finalState: state };
}
