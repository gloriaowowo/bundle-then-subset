export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue;
};
export type ValueExpr = {
    kind: "literal";
    value: JsonValue;
} | {
    kind: "path";
    path: string;
};
export type ComparisonOp = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in" | "exists";
export type Expression = {
    op: "all" | "any";
    args: Expression[];
} | {
    op: "not";
    arg: Expression;
} | {
    op: ComparisonOp;
    left: ValueExpr;
    right?: ValueExpr;
};
export interface EvidenceItem {
    id: string;
    organizationId: string;
    sequence: number;
    observedAt: string;
    type: "document" | "message" | "tool_schema" | "correction";
    sourceId: string;
    sourceRole: string;
    authority: "policy" | "system" | "manager" | "employee";
    content: string;
}
export interface OrganizationClaim {
    id: string;
    subject: string;
    predicate: string;
    object: JsonValue;
    scope: string;
    effectiveFrom?: string;
    effectiveUntil?: string;
    confidence: number;
    provenance: string[];
    status: "candidate" | "active" | "superseded" | "rejected";
}
export type WorkflowStep = {
    kind: "tool";
    tool: string;
    args: Record<string, ValueExpr>;
} | {
    kind: "require_approval";
    role: string;
    reason: string;
} | {
    kind: "escalate";
    queue: string;
    reason: string;
} | {
    kind: "respond";
    code: string;
    fields: Record<string, ValueExpr>;
} | {
    kind: "abstain";
    reason: string;
};
export interface WorkflowRule {
    id: string;
    when: Expression;
    steps: WorkflowStep[];
    otherwise?: WorkflowStep[];
    provenance: string[];
}
export interface WorkflowArtifact {
    id: string;
    organizationId: string;
    taskFamily: string;
    version: number;
    trigger: Expression;
    rules: WorkflowRule[];
    provenance: string[];
    status: "candidate" | "active" | "rejected" | "rolled_back";
}
export interface WorldState {
    [key: string]: JsonValue;
}
export interface TraceEventBase {
    sequence: number;
}
export type TraceEvent = (TraceEventBase & {
    kind: "tool";
    tool: string;
    args: Record<string, JsonValue>;
    mutates: boolean;
}) | (TraceEventBase & {
    kind: "approval";
    role: string;
    reason: string;
}) | (TraceEventBase & {
    kind: "escalation";
    queue: string;
    reason: string;
}) | (TraceEventBase & {
    kind: "response";
    code: string;
    fields: Record<string, JsonValue>;
}) | (TraceEventBase & {
    kind: "abstention";
    reason: string;
});
export interface ActionTrace {
    taskId: string;
    workflowId?: string;
    workflowVersion?: number;
    events: TraceEvent[];
    citedClaims: string[];
    citedEvidence: string[];
}
export interface EventMatch {
    kind: TraceEvent["kind"];
    tool?: string;
    role?: string;
    queue?: string;
    code?: string;
}
export interface ApprovalRequirement {
    role: string;
    beforeTools?: string[];
}
export interface TaskCase {
    id: string;
    organizationId: string;
    family: string;
    category: "decision" | "workflow" | "policy_edge";
    actorRole: string;
    requestText: string;
    input: Record<string, JsonValue>;
    initialState: WorldState;
    assertions: Expression[];
    requiredEvents: EventMatch[];
    forbiddenEvents: EventMatch[];
    requiredApprovals: ApprovalRequirement[];
}
export interface ToolContext {
    actorRole: string;
    taskInput: Record<string, JsonValue>;
    state: WorldState;
}
export interface ToolResult {
    state: WorldState;
    output?: JsonValue;
}
export interface ToolDefinition {
    name: string;
    mutates: boolean;
    execute: (args: Record<string, JsonValue>, context: ToolContext) => ToolResult;
}
export interface ExecutionResult {
    trace: ActionTrace;
    finalState: WorldState;
    matchedRuleId?: string;
}
export interface GradeResult {
    functionalPass: boolean;
    policyPass: boolean;
    groundingPass: boolean;
    automatedPass: boolean;
    failures: string[];
}
