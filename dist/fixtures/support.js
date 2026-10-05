const literal = (value) => ({ kind: "literal", value });
const path = (value) => ({ kind: "path", path: value });
export const SUPPORT_EVIDENCE = [
    {
        id: "ev-refund-v1",
        organizationId: "support-northstar",
        sequence: 1,
        observedAt: "2026-01-02T09:00:00Z",
        type: "document",
        sourceId: "support-policy-v1",
        sourceRole: "policy_owner",
        authority: "policy",
        content: "Verified standard accounts may receive credits up to $100 without manager approval.",
    },
    {
        id: "ev-enterprise-exception",
        organizationId: "support-northstar",
        sequence: 2,
        observedAt: "2026-01-02T09:05:00Z",
        type: "document",
        sourceId: "enterprise-support-policy",
        sourceRole: "policy_owner",
        authority: "policy",
        content: "Verified enterprise accounts may receive service credits up to $500 without manager approval.",
    },
    {
        id: "ev-unverified-escalation",
        organizationId: "support-northstar",
        sequence: 3,
        observedAt: "2026-01-02T09:10:00Z",
        type: "document",
        sourceId: "identity-policy",
        sourceRole: "security",
        authority: "policy",
        content: "Never issue credits to an unverified account; escalate the request to the identity-review queue.",
    },
    {
        id: "ev-refund-v2",
        organizationId: "support-northstar",
        sequence: 4,
        observedAt: "2026-04-01T00:00:00Z",
        type: "correction",
        sourceId: "support-policy-v2",
        sourceRole: "policy_owner",
        authority: "policy",
        content: "Effective April 1, the no-approval limit for standard accounts is $75, replacing the prior $100 limit.",
    },
];
function cloneState(state) {
    return structuredClone(state);
}
export const SUPPORT_TOOLS = new Map([
    [
        "issue_credit",
        {
            name: "issue_credit",
            mutates: true,
            execute: (args, context) => {
                const customerId = args.customerId;
                const amount = args.amount;
                const creditType = args.creditType;
                if (typeof customerId !== "string" ||
                    typeof amount !== "number" ||
                    typeof creditType !== "string") {
                    throw new Error("issue_credit received invalid arguments");
                }
                const state = cloneState(context.state);
                const existingCredits = typeof state.credits === "object" &&
                    state.credits !== null &&
                    !Array.isArray(state.credits)
                    ? state.credits
                    : {};
                state.credits = {
                    ...existingCredits,
                    [customerId]: { amount, creditType },
                };
                return { state };
            },
        },
    ],
]);
export const SUPPORT_ORACLE_WORKFLOW = {
    id: "support-credit-oracle",
    organizationId: "support-northstar",
    taskFamily: "support_credit",
    version: 2,
    trigger: {
        op: "eq",
        left: path("input.taskFamily"),
        right: literal("support_credit"),
    },
    provenance: SUPPORT_EVIDENCE.map((item) => item.id),
    status: "active",
    rules: [
        {
            id: "unverified",
            when: {
                op: "eq",
                left: path("input.verified"),
                right: literal(false),
            },
            provenance: ["ev-unverified-escalation"],
            steps: [
                {
                    kind: "escalate",
                    queue: "identity-review",
                    reason: "Account is not verified.",
                },
            ],
        },
        {
            id: "standard-within-limit",
            when: {
                op: "all",
                args: [
                    {
                        op: "eq",
                        left: path("input.verified"),
                        right: literal(true),
                    },
                    {
                        op: "eq",
                        left: path("input.tier"),
                        right: literal("standard"),
                    },
                    {
                        op: "lte",
                        left: path("input.amount"),
                        right: literal(75),
                    },
                ],
            },
            provenance: ["ev-refund-v2"],
            steps: [
                {
                    kind: "tool",
                    tool: "issue_credit",
                    args: {
                        customerId: path("input.customerId"),
                        amount: path("input.amount"),
                        creditType: literal("refund_credit"),
                    },
                },
            ],
        },
        {
            id: "enterprise-within-limit",
            when: {
                op: "all",
                args: [
                    {
                        op: "eq",
                        left: path("input.verified"),
                        right: literal(true),
                    },
                    {
                        op: "eq",
                        left: path("input.tier"),
                        right: literal("enterprise"),
                    },
                    {
                        op: "lte",
                        left: path("input.amount"),
                        right: literal(500),
                    },
                ],
            },
            provenance: ["ev-enterprise-exception"],
            steps: [
                {
                    kind: "tool",
                    tool: "issue_credit",
                    args: {
                        customerId: path("input.customerId"),
                        amount: path("input.amount"),
                        creditType: literal("service_credit"),
                    },
                },
            ],
        },
        {
            id: "manager-approval",
            when: {
                op: "eq",
                left: path("input.verified"),
                right: literal(true),
            },
            provenance: ["ev-refund-v2", "ev-enterprise-exception"],
            steps: [
                {
                    kind: "require_approval",
                    role: "support_manager",
                    reason: "Requested credit exceeds the agent's approval limit.",
                },
            ],
        },
    ],
};
const emptyState = () => ({ credits: {} });
export const SUPPORT_TASKS = [
    {
        id: "support-standard-auto",
        organizationId: "support-northstar",
        family: "support_credit",
        category: "workflow",
        actorRole: "support_agent",
        requestText: "Issue a $50 refund credit to verified customer C-001.",
        input: {
            taskFamily: "support_credit",
            customerId: "C-001",
            tier: "standard",
            verified: true,
            amount: 50,
        },
        initialState: emptyState(),
        assertions: [
            {
                op: "eq",
                left: path("state.credits.C-001.amount"),
                right: literal(50),
            },
        ],
        requiredEvents: [{ kind: "tool", tool: "issue_credit" }],
        forbiddenEvents: [{ kind: "approval", role: "support_manager" }],
        requiredApprovals: [],
    },
    {
        id: "support-standard-updated-limit",
        organizationId: "support-northstar",
        family: "support_credit",
        category: "policy_edge",
        actorRole: "support_agent",
        requestText: "Issue a $90 refund credit to verified customer C-002.",
        input: {
            taskFamily: "support_credit",
            customerId: "C-002",
            tier: "standard",
            verified: true,
            amount: 90,
        },
        initialState: emptyState(),
        assertions: [],
        requiredEvents: [{ kind: "approval", role: "support_manager" }],
        forbiddenEvents: [{ kind: "tool", tool: "issue_credit" }],
        requiredApprovals: [{ role: "support_manager" }],
    },
    {
        id: "support-enterprise-exception",
        organizationId: "support-northstar",
        family: "support_credit",
        category: "workflow",
        actorRole: "support_agent",
        requestText: "Issue a $400 service credit to verified enterprise C-003.",
        input: {
            taskFamily: "support_credit",
            customerId: "C-003",
            tier: "enterprise",
            verified: true,
            amount: 400,
        },
        initialState: emptyState(),
        assertions: [
            {
                op: "eq",
                left: path("state.credits.C-003.creditType"),
                right: literal("service_credit"),
            },
        ],
        requiredEvents: [{ kind: "tool", tool: "issue_credit" }],
        forbiddenEvents: [{ kind: "approval", role: "support_manager" }],
        requiredApprovals: [],
    },
    {
        id: "support-unverified",
        organizationId: "support-northstar",
        family: "support_credit",
        category: "policy_edge",
        actorRole: "support_agent",
        requestText: "Issue a $20 refund credit to unverified customer C-004.",
        input: {
            taskFamily: "support_credit",
            customerId: "C-004",
            tier: "standard",
            verified: false,
            amount: 20,
        },
        initialState: emptyState(),
        assertions: [],
        requiredEvents: [
            { kind: "escalation", queue: "identity-review" },
        ],
        forbiddenEvents: [{ kind: "tool", tool: "issue_credit" }],
        requiredApprovals: [],
    },
];
//# sourceMappingURL=support.js.map