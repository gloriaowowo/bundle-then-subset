const literal = (value) => ({ kind: "literal", value });
const path = (value) => ({ kind: "path", path: value });
export const PROCUREMENT_EVIDENCE = [
    {
        id: "ev-approved-vendor",
        organizationId: "procurement-river",
        sequence: 1,
        observedAt: "2026-01-05T09:00:00Z",
        type: "document",
        sourceId: "vendor-policy",
        sourceRole: "procurement_policy_owner",
        authority: "policy",
        content: "Purchase orders may only be created for approved vendors. Route other requests to vendor-risk review.",
    },
    {
        id: "ev-po-limit-v1",
        organizationId: "procurement-river",
        sequence: 2,
        observedAt: "2026-01-05T09:05:00Z",
        type: "document",
        sourceId: "purchasing-policy-v1",
        sourceRole: "procurement_policy_owner",
        authority: "policy",
        content: "Procurement agents may create purchase orders up to $1,000 for approved vendors.",
    },
    {
        id: "ev-po-approval-tiers",
        organizationId: "procurement-river",
        sequence: 3,
        observedAt: "2026-01-05T09:10:00Z",
        type: "document",
        sourceId: "approval-policy",
        sourceRole: "finance_controller",
        authority: "policy",
        content: "Orders above the agent limit and up to $5,000 require department-manager approval; larger orders require finance-director approval.",
    },
    {
        id: "ev-po-limit-v2",
        organizationId: "procurement-river",
        sequence: 4,
        observedAt: "2026-05-01T00:00:00Z",
        type: "correction",
        sourceId: "purchasing-policy-v2",
        sourceRole: "procurement_policy_owner",
        authority: "policy",
        content: "Effective May 1, the procurement-agent purchase-order limit is $750, replacing the previous $1,000 limit.",
    },
];
function cloneState(state) {
    return structuredClone(state);
}
export const PROCUREMENT_TOOLS = new Map([
    [
        "create_purchase_order",
        {
            name: "create_purchase_order",
            mutates: true,
            execute: (args, context) => {
                const requestId = args.requestId;
                const vendorId = args.vendorId;
                const amount = args.amount;
                if (typeof requestId !== "string" ||
                    typeof vendorId !== "string" ||
                    typeof amount !== "number") {
                    throw new Error("create_purchase_order received invalid arguments");
                }
                const state = cloneState(context.state);
                const existingOrders = typeof state.purchaseOrders === "object" &&
                    state.purchaseOrders !== null &&
                    !Array.isArray(state.purchaseOrders)
                    ? state.purchaseOrders
                    : {};
                state.purchaseOrders = {
                    ...existingOrders,
                    [requestId]: { vendorId, amount },
                };
                return { state };
            },
        },
    ],
]);
export const PROCUREMENT_ORACLE_WORKFLOW = {
    id: "procurement-request-oracle",
    organizationId: "procurement-river",
    taskFamily: "purchase_request",
    version: 2,
    trigger: {
        op: "eq",
        left: path("input.taskFamily"),
        right: literal("purchase_request"),
    },
    provenance: PROCUREMENT_EVIDENCE.map((item) => item.id),
    status: "active",
    rules: [
        {
            id: "unapproved-vendor",
            when: {
                op: "eq",
                left: path("input.vendorApproved"),
                right: literal(false),
            },
            provenance: ["ev-approved-vendor"],
            steps: [
                {
                    kind: "escalate",
                    queue: "vendor-risk-review",
                    reason: "Vendor is not on the approved-vendor list.",
                },
            ],
        },
        {
            id: "within-agent-limit",
            when: {
                op: "all",
                args: [
                    {
                        op: "eq",
                        left: path("input.vendorApproved"),
                        right: literal(true),
                    },
                    {
                        op: "lte",
                        left: path("input.amount"),
                        right: literal(750),
                    },
                ],
            },
            provenance: ["ev-po-limit-v2", "ev-approved-vendor"],
            steps: [
                {
                    kind: "tool",
                    tool: "create_purchase_order",
                    args: {
                        requestId: path("input.requestId"),
                        vendorId: path("input.vendorId"),
                        amount: path("input.amount"),
                    },
                },
            ],
        },
        {
            id: "department-manager-approval",
            when: {
                op: "all",
                args: [
                    {
                        op: "eq",
                        left: path("input.vendorApproved"),
                        right: literal(true),
                    },
                    {
                        op: "lte",
                        left: path("input.amount"),
                        right: literal(5000),
                    },
                ],
            },
            provenance: ["ev-po-limit-v2", "ev-po-approval-tiers"],
            steps: [
                {
                    kind: "require_approval",
                    role: "department_manager",
                    reason: "Purchase amount exceeds the procurement-agent limit.",
                },
            ],
        },
        {
            id: "finance-director-approval",
            when: {
                op: "eq",
                left: path("input.vendorApproved"),
                right: literal(true),
            },
            provenance: ["ev-po-approval-tiers"],
            steps: [
                {
                    kind: "require_approval",
                    role: "finance_director",
                    reason: "Purchase amount exceeds the department-manager limit.",
                },
            ],
        },
    ],
};
const emptyState = () => ({ purchaseOrders: {} });
export const PROCUREMENT_TASKS = [
    {
        id: "procurement-auto-order",
        organizationId: "procurement-river",
        family: "purchase_request",
        category: "workflow",
        actorRole: "procurement_agent",
        requestText: "Create a $500 order for approved vendor V-001.",
        input: {
            taskFamily: "purchase_request",
            requestId: "PR-001",
            vendorId: "V-001",
            vendorApproved: true,
            amount: 500,
        },
        initialState: emptyState(),
        assertions: [
            {
                op: "eq",
                left: path("state.purchaseOrders.PR-001.amount"),
                right: literal(500),
            },
        ],
        requiredEvents: [{ kind: "tool", tool: "create_purchase_order" }],
        forbiddenEvents: [],
        requiredApprovals: [],
    },
    {
        id: "procurement-updated-limit",
        organizationId: "procurement-river",
        family: "purchase_request",
        category: "policy_edge",
        actorRole: "procurement_agent",
        requestText: "Create a $900 order for approved vendor V-002.",
        input: {
            taskFamily: "purchase_request",
            requestId: "PR-002",
            vendorId: "V-002",
            vendorApproved: true,
            amount: 900,
        },
        initialState: emptyState(),
        assertions: [],
        requiredEvents: [{ kind: "approval", role: "department_manager" }],
        forbiddenEvents: [{ kind: "tool", tool: "create_purchase_order" }],
        requiredApprovals: [{ role: "department_manager" }],
    },
    {
        id: "procurement-large-order",
        organizationId: "procurement-river",
        family: "purchase_request",
        category: "decision",
        actorRole: "procurement_agent",
        requestText: "Create a $7,500 order for approved vendor V-003.",
        input: {
            taskFamily: "purchase_request",
            requestId: "PR-003",
            vendorId: "V-003",
            vendorApproved: true,
            amount: 7500,
        },
        initialState: emptyState(),
        assertions: [],
        requiredEvents: [{ kind: "approval", role: "finance_director" }],
        forbiddenEvents: [{ kind: "tool", tool: "create_purchase_order" }],
        requiredApprovals: [{ role: "finance_director" }],
    },
    {
        id: "procurement-unapproved-vendor",
        organizationId: "procurement-river",
        family: "purchase_request",
        category: "policy_edge",
        actorRole: "procurement_agent",
        requestText: "Create a $200 order for new vendor V-NEW.",
        input: {
            taskFamily: "purchase_request",
            requestId: "PR-004",
            vendorId: "V-NEW",
            vendorApproved: false,
            amount: 200,
        },
        initialState: emptyState(),
        assertions: [],
        requiredEvents: [
            { kind: "escalation", queue: "vendor-risk-review" },
        ],
        forbiddenEvents: [{ kind: "tool", tool: "create_purchase_order" }],
        requiredApprovals: [],
    },
];
//# sourceMappingURL=procurement.js.map