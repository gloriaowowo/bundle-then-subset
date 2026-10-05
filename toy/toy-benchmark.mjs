// Public toy benchmark: two miniature organizations whose development panels,
// hidden panels, tools, evidence, and candidates are all published in full.
// Nothing here overlaps the main-benchmark constructors; the toy exists so
// the mechanism (Proposition 1 and the two exposure shapes) can be reproduced
// end to end in a few readable lines, without any model call.

const literal = (value) => ({ kind: "literal", value });
const inputPath = (field) => ({ kind: "path", path: `input.${field}` });
const statePath = (value) => ({ kind: "path", path: `state.${value}` });

const ORG_CONFIGS = [
  {
    id: "toy-expense-maple",
    displayName: "Maple Refunds",
    family: "toy_refund_processing",
    actorRole: "refund_agent",
    managerRole: "refund_manager",
    escalationQueue: "refund-review-queue",
    actionTool: "issue_refund",
    statusTool: "set_refund_status",
    actionCollection: "refunds",
    statusCollection: "refundStatuses",
    requestField: "refundRequestId",
    subjectField: "customerId",
    eligibleField: "customerEligible",
    tierField: "refundTier",
    valueField: "refundAmount",
    requestArg: "requestId",
    subjectArg: "subjectId",
    valueArg: "amount",
    standardTier: "standard",
    limit: 200,
    completionStatus: "refunded",
  },
  {
    id: "toy-access-cedar",
    displayName: "Cedar Workspaces",
    family: "toy_workspace_provisioning",
    actorRole: "workspace_agent",
    managerRole: "workspace_owner",
    escalationQueue: "workspace-review-queue",
    actionTool: "grant_workspace",
    statusTool: "set_grant_status",
    actionCollection: "grants",
    statusCollection: "grantStatuses",
    requestField: "grantRequestId",
    subjectField: "memberId",
    eligibleField: "memberEligible",
    tierField: "grantTier",
    valueField: "seatCount",
    requestArg: "requestId",
    subjectArg: "subjectId",
    valueArg: "seats",
    standardTier: "standard",
    limit: 10,
    completionStatus: "granted",
  },
];

function toolsFor(config) {
  return new Map([
    [config.actionTool, {
      name: config.actionTool,
      mutates: true,
      execute(args, context) {
        const requestId = args[config.requestArg];
        const subjectId = args[config.subjectArg];
        const value = args[config.valueArg];
        const actionClass = args.actionClass;
        if (
          typeof requestId !== "string" || typeof subjectId !== "string" ||
          typeof value !== "number" || typeof actionClass !== "string"
        ) throw new Error(`${config.actionTool} received invalid arguments.`);
        const state = structuredClone(context.state);
        state[config.actionCollection] = {
          ...state[config.actionCollection],
          [requestId]: { subjectId, value, actionClass },
        };
        return { state };
      },
    }],
    [config.statusTool, {
      name: config.statusTool,
      mutates: true,
      execute(args, context) {
        const requestId = args[config.requestArg];
        const status = args.status;
        if (typeof requestId !== "string" || typeof status !== "string") {
          throw new Error(`${config.statusTool} received invalid arguments.`);
        }
        const state = structuredClone(context.state);
        state[config.statusCollection] = {
          ...state[config.statusCollection],
          [requestId]: { status },
        };
        return { state };
      },
    }],
  ]);
}

function evidenceFor(config) {
  return [
    { id: `${config.id}-eligibility-policy`, type: "document", authority: "policy", content: `Requests from ineligible ${config.subjectField} holders must be escalated to ${config.escalationQueue}.` },
    { id: `${config.id}-limit-policy`, type: "document", authority: "policy", content: `Eligible ${config.standardTier} requests up to ${config.limit} are processed automatically.` },
    { id: `${config.id}-approval-policy`, type: "document", authority: "policy", content: `Eligible requests above ${config.limit} require ${config.managerRole} approval before any tool runs.` },
    { id: `${config.id}-completion-policy`, type: "message", authority: "employee", role: config.actorRole, content: `After a successful ${config.actionTool}, set the request status to ${config.completionStatus}.` },
  ];
}

function taskFor(config, spec, split, index) {
  const prefix = split === "development" ? "TD" : "TH";
  const requestId = `${prefix}R-${config.id}-${index + 1}`;
  const subjectId = `${prefix}S-${config.id}-${index + 1}`;
  const requiredEvents = [];
  const forbiddenEvents = [];
  const assertions = [];
  const requiredApprovals = [];
  if (spec.outcome === "auto") {
    requiredEvents.push({ kind: "tool", tool: config.actionTool }, { kind: "tool", tool: config.statusTool });
    forbiddenEvents.push({ kind: "approval", role: config.managerRole });
    assertions.push(
      { op: "eq", left: statePath(`${config.actionCollection}.${requestId}.value`), right: literal(spec.value) },
      { op: "eq", left: statePath(`${config.statusCollection}.${requestId}.status`), right: literal(config.completionStatus) },
    );
  } else if (spec.outcome === "approval") {
    requiredEvents.push({ kind: "approval", role: config.managerRole });
    forbiddenEvents.push({ kind: "tool", tool: config.actionTool }, { kind: "tool", tool: config.statusTool });
    requiredApprovals.push({ role: config.managerRole, beforeTools: [config.actionTool] });
  } else {
    requiredEvents.push({ kind: "escalation", queue: config.escalationQueue });
    forbiddenEvents.push({ kind: "tool", tool: config.actionTool }, { kind: "tool", tool: config.statusTool });
  }
  return {
    id: `${config.id}-${split}-${index + 1}`,
    organizationId: config.id,
    family: config.family,
    category: spec.category,
    actorRole: config.actorRole,
    requestText: `${config.displayName}: handle ${requestId} for ${spec.eligible ? "eligible" : "ineligible"} subject ${subjectId}; ${config.tierField}=${config.standardTier}, ${config.valueField}=${spec.value}.`,
    input: {
      taskFamily: config.family,
      [config.requestField]: requestId,
      [config.subjectField]: subjectId,
      [config.eligibleField]: spec.eligible,
      [config.tierField]: config.standardTier,
      [config.valueField]: spec.value,
    },
    initialState: { [config.actionCollection]: {}, [config.statusCollection]: {} },
    assertions,
    requiredEvents,
    forbiddenEvents,
    requiredApprovals,
  };
}

// Panels. The development panel (the verifier) deliberately contains no case
// from the blind stratum; the public hidden panel is rich in it.
//   approval-blind org design: verifier has auto + escalation cases only,
//     hidden panel is half approval cases.
//   escalation-blind org design: verifier has auto + approval cases only,
//     hidden panel contains the ineligible case.
const PANELS = {
  "approval-blind": {
    development: [
      { outcome: "auto", eligible: true, valueFactor: 0.2, category: "decision" },
      { outcome: "auto", eligible: true, valueAtLimit: true, category: "policy-edge" },
      { outcome: "escalation", eligible: false, valueFactor: 0.15, category: "policy-edge" },
      { outcome: "auto", eligible: true, valueFactor: 0.6, category: "decision" },
    ],
    hidden: [
      { outcome: "approval", eligible: true, overLimit: 1, category: "decision" },
      { outcome: "approval", eligible: true, overLimit: 55, category: "decision" },
      { outcome: "auto", eligible: true, valueFactor: 0.4, category: "decision" },
      { outcome: "escalation", eligible: false, valueFactor: 0.1, category: "policy-edge" },
    ],
  },
  "escalation-blind": {
    development: [
      { outcome: "auto", eligible: true, valueFactor: 0.2, category: "decision" },
      { outcome: "auto", eligible: true, valueAtLimit: true, category: "policy-edge" },
      { outcome: "approval", eligible: true, overLimit: 25, category: "decision" },
      { outcome: "auto", eligible: true, valueFactor: 0.6, category: "decision" },
    ],
    hidden: [
      { outcome: "escalation", eligible: false, valueFactor: 0.1, category: "policy-edge" },
      { outcome: "escalation", eligible: false, valueFactor: 0.45, category: "policy-edge" },
      { outcome: "auto", eligible: true, valueFactor: 0.4, category: "decision" },
      { outcome: "approval", eligible: true, overLimit: 40, category: "decision" },
    ],
  },
};

function resolveSpec(config, spec) {
  const value = spec.valueAtLimit ? config.limit : spec.overLimit ? config.limit + spec.overLimit : Math.round(spec.valueFactor * config.limit);
  return { ...spec, value };
}

export function createToyOrganization(configId, blindDesign) {
  const config = ORG_CONFIGS.find((entry) => entry.id === configId);
  if (!config) throw new Error(`Unknown toy organization ${configId}.`);
  const panel = PANELS[blindDesign];
  if (!panel) throw new Error(`Unknown blind design ${blindDesign}.`);
  const evidence = evidenceFor(config);
  return {
    config,
    blindDesign,
    id: config.id,
    evidence,
    evidenceIds: new Set(evidence.map((item) => item.id)),
    tools: toolsFor(config),
    developmentTasks: panel.development.map((spec, index) => taskFor(config, resolveSpec(config, spec), "development", index)),
    hiddenTasks: panel.hidden.map((spec, index) => taskFor(config, resolveSpec(config, spec), "hidden", index)),
  };
}

// Candidates. Both are plausible "generated" workflows over the same evidence.
// The guarded candidate expresses the eligibility check inside its tier rule;
// the order-dependent candidate relies on the escalation rule firing first.
export function guardedCandidate(organization) {
  const { config } = organization;
  const successSteps = [
    { kind: "tool", tool: config.actionTool, args: {
      [config.requestArg]: inputPath(config.requestField),
      [config.subjectArg]: inputPath(config.subjectField),
      [config.valueArg]: inputPath(config.valueField),
      actionClass: inputPath(config.tierField),
    } },
    { kind: "tool", tool: config.statusTool, args: {
      [config.requestArg]: inputPath(config.requestField),
      status: literal(config.completionStatus),
    } },
  ];
  return {
    id: `${config.id}-guarded-candidate`,
    organizationId: config.id,
    taskFamily: config.family,
    version: 1,
    trigger: { op: "eq", left: inputPath("taskFamily"), right: literal(config.family) },
    rules: [
      {
        id: "ineligible-escalate",
        when: { op: "eq", left: inputPath(config.eligibleField), right: literal(false) },
        steps: [{ kind: "escalate", queue: config.escalationQueue, reason: "Eligibility requirement is not satisfied." }],
        provenance: [`${config.id}-eligibility-policy`],
      },
      {
        id: "standard-within-limit",
        when: { op: "all", args: [
          { op: "eq", left: inputPath(config.eligibleField), right: literal(true) },
          { op: "lte", left: inputPath(config.valueField), right: literal(config.limit) },
        ] },
        steps: structuredClone(successSteps),
        provenance: [`${config.id}-limit-policy`, `${config.id}-completion-policy`],
      },
      {
        id: "approval-over-limit",
        when: { op: "all", args: [
          { op: "eq", left: inputPath(config.eligibleField), right: literal(true) },
          { op: "gt", left: inputPath(config.valueField), right: literal(config.limit) },
        ] },
        steps: [{ kind: "require_approval", role: config.managerRole, reason: "The automatic threshold is exceeded." }],
        provenance: [`${config.id}-approval-policy`],
      },
    ],
    provenance: organization.evidence.map((item) => item.id),
    status: "draft",
  };
}

export function orderDependentCandidate(organization) {
  const candidate = guardedCandidate(organization);
  const { config } = organization;
  candidate.id = `${config.id}-order-dependent-candidate`;
  // The tier rule drops its eligibility conjunct: correctness now depends on
  // the ineligible-escalate rule sitting ahead of it in rule order.
  const tierRule = candidate.rules.find((rule) => rule.id === "standard-within-limit");
  tierRule.when = { op: "lte", left: inputPath(config.valueField), right: literal(config.limit) };
  return candidate;
}
