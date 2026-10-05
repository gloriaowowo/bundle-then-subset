import { SEED_SYSTEM_PROMPT } from "../seed.js";
const WORKFLOW_CONTRACT = `Return exactly one JSON WorkflowArtifact with no prose or markdown.
Required fields: id, organizationId, taskFamily, version, trigger, rules, provenance, status.
status must be "candidate". Each rule has id, when, steps, provenance and an
optional otherwise array. A workflow may contain at most 8 rules and 8 steps in
total; every rule must contain at least one step.

Use these exact expression shapes, never operator names as object keys:
- {"op":"all","args":[EXPRESSION,...]} or {"op":"any","args":[EXPRESSION,...]}
- {"op":"not","arg":EXPRESSION}
- {"op":"eq|neq|lt|lte|gt|gte|in","left":VALUE_EXPR,"right":VALUE_EXPR}
- {"op":"exists","left":VALUE_EXPR}
VALUE_EXPR is exactly {"kind":"literal","value":JSON_VALUE} or
{"kind":"path","path":"input.field"}.

Use these exact step shapes and field names:
- {"kind":"tool","tool":"DECLARED_TOOL_NAME","args":{"argName":VALUE_EXPR}}
- {"kind":"require_approval","role":"ROLE","reason":"REASON"}
- {"kind":"escalate","queue":"QUEUE","reason":"REASON"}
- {"kind":"respond","code":"CODE","fields":{"field":VALUE_EXPR}}
- {"kind":"abstain","reason":"REASON"}

Minimal structural example (replace every illustrative value; do not copy
exampleField):
{"id":"replace-me","organizationId":"replace-me","taskFamily":"replace-me","version":1,"trigger":{"op":"eq","left":{"kind":"path","path":"input.taskFamily"},"right":{"kind":"literal","value":"replace-me"}},"rules":[{"id":"replace-me","when":{"op":"exists","left":{"kind":"path","path":"input.exampleField"}},"steps":[{"kind":"abstain","reason":"replace-me"}],"provenance":["replace-with-visible-evidence-id"]}],"provenance":["replace-with-visible-evidence-id"],"status":"candidate"}

Never emit code, loops, network calls, undeclared tools, undeclared input paths,
or fields not listed above. Every policy-bearing rule must cite visible evidence
IDs.`;
function publicEvidence(evidence) {
    return evidence.map((item) => ({
        id: item.id,
        sequence: item.sequence,
        observedAt: item.observedAt,
        type: item.type,
        sourceRole: item.sourceRole,
        authority: item.authority,
        content: item.content,
    }));
}
function publicTools(tools) {
    return [...tools.values()].map((tool) => ({
        name: tool.name,
        mutates: tool.mutates,
    }));
}
function publicTask(task) {
    return {
        id: task.id,
        organizationId: task.organizationId,
        family: task.family,
        actorRole: task.actorRole,
        requestText: task.requestText,
        input: task.input,
        initialState: task.initialState,
    };
}
function jsonType(value) {
    if (value === null)
        return "null";
    if (Array.isArray(value))
        return "array";
    return typeof value;
}
function publicTaskInputSchema(tasks, taskFamily) {
    const typesByField = new Map();
    for (const task of tasks) {
        if (task.family !== taskFamily)
            continue;
        for (const [field, value] of Object.entries(task.input)) {
            const types = typesByField.get(field) ?? new Set();
            types.add(jsonType(value));
            typesByField.set(field, types);
        }
    }
    return Object.fromEntries([...typesByField.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([field, types]) => [field, [...types].sort()]));
}
export const WORKFLOW_SYSTEM_PROMPT = `${SEED_SYSTEM_PROMPT}\n\n${WORKFLOW_CONTRACT}`;
export function rawContextTaskPrompt(task, evidence, tools) {
    return JSON.stringify({
        objective: "Construct a one-shot workflow for this task from visible evidence.",
        task: publicTask(task),
        visibleEvidence: publicEvidence(evidence),
        tools: publicTools(tools),
    });
}
export function memoryTaskPrompt(task, claims, tools) {
    return JSON.stringify({
        objective: "Construct a one-shot workflow for this task using active grounded organization claims. In every workflow and rule provenance array, copy only original evidence IDs from activeClaims[].provenance; never cite a claim ID as if it were an evidence ID.",
        task: publicTask(task),
        activeClaims: claims,
        tools: publicTools(tools),
    });
}
export function claimInductionPrompt(organizationId, taskFamily, taskCases, evidence) {
    return JSON.stringify({
        objective: "Induce the minimal current organization model needed to execute the task family. Resolve explicit updates using source authority and chronology; consolidate redundant evidence into shared claims.",
        organizationId,
        taskFamily,
        taskInputSchema: publicTaskInputSchema(taskCases, taskFamily),
        visibleEvidence: publicEvidence(evidence),
        outputContract: {
            topLevel: { claims: "OrganizationClaim[]" },
            maxClaims: 16,
            claimFields: [
                "id",
                "subject",
                "predicate",
                "object",
                "scope",
                "confidence",
                "provenance",
                "status",
            ],
            optionalFields: ["effectiveFrom", "effectiveUntil"],
            instruction: "Return JSON only. Cite visible evidence IDs. Merge redundant support into provenance arrays. Prefer policy, authorization, thresholds, exceptions, tool arguments, and workflow obligations needed by the task family. Mark only currently supported claims active; include a superseded claim only when needed to represent an explicit update.",
        },
    });
}
export function directWorkflowInductionPrompt(organizationId, taskFamily, taskCases, evidence, tools, claims = [], revision) {
    return JSON.stringify({
        objective: "Induce one reusable workflow covering the task family from the organization evidence.",
        organizationId,
        taskFamily,
        taskInputSchema: publicTaskInputSchema(taskCases, taskFamily),
        visibleEvidence: publicEvidence(evidence),
        activeClaims: claims,
        tools: publicTools(tools),
        ...(revision
            ? {
                revision: {
                    instruction: "Revise the candidate using only these aggregate promotion counts. Do not infer or request hidden case details.",
                    previousCandidate: revision.previousCandidate ?? null,
                    aggregateFeedback: revision.aggregateFeedback,
                },
            }
            : {}),
    });
}
//# sourceMappingURL=prompts.js.map