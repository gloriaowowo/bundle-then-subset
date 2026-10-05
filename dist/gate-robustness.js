import assert from "node:assert/strict";
import path from "node:path";
import { createRobustnessOrganizations, EVIDENCE_GAP_REGIMES, orderEvidenceByAuthoritativeGap, } from "./generator/robustness.js";
import { generateSharedWorkflowCandidate } from "./methods/model-conditions.js";
import { applyPromotionGate } from "./methods/promotion.js";
import { BudgetTracker } from "./model/budget.js";
import { FileModelCache } from "./model/cache.js";
import { JsonModelGateway } from "./model/gateway.js";
for (const regime of EVIDENCE_GAP_REGIMES) {
    const organizations = createRobustnessOrganizations(regime);
    assert.equal(organizations.length, 8);
    assert.equal(new Set(organizations.map((organization) => organization.id)).size, 8);
    for (const organization of organizations) {
        assert.deepEqual(organization.developmentTasks.reduce((counts, task) => {
            counts[task.category] = (counts[task.category] ?? 0) + 1;
            return counts;
        }, {}), { decision: 3, workflow: 2, policy_edge: 3 });
        const hiddenCategoryCounts = organization.hiddenTasks.reduce((counts, task) => {
            counts[task.category] = (counts[task.category] ?? 0) + 1;
            return counts;
        }, {});
        assert.deepEqual(hiddenCategoryCounts, organization.domain === "support"
            ? { decision: 4, workflow: 6, policy_edge: 3 }
            : { decision: 3, workflow: 5, policy_edge: 4 });
        const scenarioKey = (task) => {
            const { taskFamily: _taskFamily, customerId: _customerId, ticketId: _ticketId, requestId: _requestId, vendorId: _vendorId, ...scenario } = task.input;
            return JSON.stringify(scenario);
        };
        const developmentScenarios = new Set(organization.developmentTasks.map(scenarioKey));
        assert.ok(organization.hiddenTasks.every((task) => !developmentScenarios.has(scenarioKey(task))));
        const canonicalIds = [...organization.evidence.map((item) => item.id)].sort();
        const reordered = orderEvidenceByAuthoritativeGap(organization.evidence, regime);
        assert.deepEqual([...reordered.map((item) => item.id)].sort(), canonicalIds);
        const actionIndex = reordered.findIndex((item) => item.id.endsWith("-limit-v2"));
        const approvalIndex = reordered.findIndex((item) => item.id.endsWith("-approval-policy"));
        assert.equal(Math.floor(approvalIndex / 8) - Math.floor(actionIndex / 8), Number(regime.slice(-1)));
    }
}
const organization = createRobustnessOrganizations("gap-0")[0];
assert.ok(organization);
let calls = 0;
const backend = {
    descriptor: { provider: "fixture", id: "shared-candidate", temperature: 0 },
    complete: async () => {
        calls += 1;
        if (calls === 1) {
            const invalid = structuredClone(organization.oracleWorkflow);
            invalid.rules = [
                ...invalid.rules,
                {
                    id: "too-many-steps",
                    when: { op: "exists", left: { kind: "path", path: "input.taskFamily" } },
                    steps: [
                        { kind: "abstain", reason: "one" },
                        { kind: "abstain", reason: "two" },
                        { kind: "abstain", reason: "three" },
                    ],
                    provenance: [organization.evidence[0].id],
                },
            ];
            return {
                text: JSON.stringify(invalid),
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, latencyMs: 1, costUsd: 0 },
            };
        }
        return {
            text: JSON.stringify(organization.oracleWorkflow),
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, latencyMs: 1, costUsd: 0 },
        };
    },
};
const gateway = new JsonModelGateway(backend, new BudgetTracker({
    maxAdaptationCalls: 2,
    maxTaskCallsPerCase: 0,
    maxTotalInputTokens: 100,
    maxTotalOutputTokens: 100,
    maxCostUsd: 1,
}), new FileModelCache(path.join(process.cwd(), "runs", `gate-robustness-${process.pid}-${Date.now()}`)));
const generation = await generateSharedWorkflowCandidate(gateway, {
    organizationId: organization.id,
    domain: organization.domain,
    checkpoint: organization.evidence.length,
    visibleEvidence: organization.evidence,
    developmentTasks: organization.developmentTasks,
    tools: organization.tools,
    trialSeed: 0,
});
assert.equal(calls, 2);
assert.equal(generation.attempts, 2);
assert.ok(generation.candidate);
assert.ok(generation.audit.some((event) => event.kind === "workflow_rejected"));
const candidate = structuredClone(generation.candidate);
const automaticRule = candidate.rules.find((rule) => rule.id === "standard-within-limit");
assert.ok(automaticRule);
candidate.rules = [
    {
        id: "unsafe-catch-all",
        when: { op: "exists", left: { kind: "path", path: "input.taskFamily" } },
        steps: structuredClone(automaticRule.steps),
        provenance: structuredClone(automaticRule.provenance),
    },
    ...candidate.rules,
];
const evidenceIds = new Set(organization.evidence.map((item) => item.id));
const direct = applyPromotionGate(candidate, "direct", organization.developmentTasks, organization.tools, evidenceIds);
const bundle = applyPromotionGate(candidate, "bundle", organization.developmentTasks, organization.tools, evidenceIds);
const subset = applyPromotionGate(candidate, "safe-subset", organization.developmentTasks, organization.tools, evidenceIds);
assert.ok(direct.activeWorkflow);
assert.equal(bundle.activeWorkflow, undefined);
assert.ok(subset.activeWorkflow);
assert.equal(subset.promotedRuleCount, candidate.rules.length - 1);
console.log(JSON.stringify({
    gate: "robustness-v0.2-plumbing",
    organizations: 8,
    evidenceGapRegimes: EVIDENCE_GAP_REGIMES,
    sharedStaticRepair: true,
    directBundleSubsetIsolation: true,
    paidModelRequestMade: false,
}, null, 2));
//# sourceMappingURL=gate-robustness.js.map