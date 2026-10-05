import assert from "node:assert/strict";
import path from "node:path";
import { runCheckpoint } from "./eval/runner.js";
import { createBenchmarkOrganizations } from "./generator/benchmark.js";
import { DirectWorkflowCondition, MemoryOnlyCondition, OrgBootCondition, RawContextCondition, } from "./methods/model-conditions.js";
import { BudgetTracker } from "./model/budget.js";
import { FileModelCache } from "./model/cache.js";
import { JsonModelGateway } from "./model/gateway.js";
const organization = createBenchmarkOrganizations()[0];
assert.ok(organization);
function createFixtureGateway(label) {
    const backend = {
        descriptor: { provider: "fixture", id: `oracle-shaped-${label}`, temperature: 0 },
        complete: async (request) => {
            const isClaimRequest = request.userPrompt.includes('"outputContract"');
            const text = isClaimRequest
                ? JSON.stringify({
                    claims: [
                        {
                            id: `${organization.id}-fixture-claim`,
                            subject: organization.id,
                            predicate: "has_visible_evidence",
                            object: true,
                            scope: "fixture-only",
                            confidence: 1,
                            provenance: [organization.evidence[0].id],
                            status: "active",
                        },
                    ],
                })
                : JSON.stringify(organization.oracleWorkflow);
            return {
                text,
                usage: {
                    inputTokens: 10,
                    outputTokens: 10,
                    totalTokens: 20,
                    latencyMs: 1,
                    costUsd: 0,
                },
            };
        },
    };
    return new JsonModelGateway(backend, new BudgetTracker({
        maxAdaptationCalls: 4,
        maxTaskCallsPerCase: 1,
        maxTotalInputTokens: 10_000,
        maxTotalOutputTokens: 10_000,
        maxCostUsd: 1,
    }), new FileModelCache(path.join(process.cwd(), "runs", `gate-methods-${process.pid}-${Date.now()}-${label}`)));
}
const conditions = [
    new RawContextCondition(createFixtureGateway("c0")),
    new MemoryOnlyCondition(createFixtureGateway("c1")),
    new DirectWorkflowCondition(createFixtureGateway("c2")),
    new OrgBootCondition(createFixtureGateway("c3")),
    new OrgBootCondition(createFixtureGateway("c3-org-model"), {
        temporalProvenance: true,
        externalPromotion: true,
        organizationModel: true,
    }),
];
const summaries = [];
for (const condition of conditions) {
    const result = await runCheckpoint(condition, organization, organization.evidence.length, 0);
    assert.equal(result.verifiedAutomationCoverage, 1, condition.id);
    if (condition.id === "C1-memory-only" ||
        condition.id === "C3-with-organization-model") {
        assert.equal(result.state.claims.length, 1, condition.id);
    }
    if (condition.id === "C2-direct-workflow" ||
        condition.id === "C3-orgboot" ||
        condition.id === "C3-with-organization-model") {
        assert.equal(result.state.activeWorkflows.length, 1, condition.id);
    }
    summaries.push({
        condition: condition.id,
        vac: result.verifiedAutomationCoverage,
        claims: result.state.claims.length,
        activeWorkflows: result.state.activeWorkflows.length,
        auditEvents: result.state.audit.length,
    });
}
let retryWorkflowCalls = 0;
const retryBackend = {
    descriptor: { provider: "fixture", id: "promotion-retry", temperature: 0 },
    complete: async (request) => {
        const isClaimRequest = request.userPrompt.includes('"outputContract"');
        let value;
        if (isClaimRequest) {
            value = {
                claims: [
                    {
                        id: `${organization.id}-retry-claim`,
                        subject: organization.id,
                        predicate: "has_visible_evidence",
                        object: true,
                        scope: "fixture-only",
                        confidence: 1,
                        provenance: [organization.evidence[0].id],
                        status: "active",
                    },
                ],
            };
        }
        else {
            retryWorkflowCalls += 1;
            if (retryWorkflowCalls === 1) {
                const noCapability = structuredClone(organization.oracleWorkflow);
                noCapability.id = `${noCapability.id}-all-abstain`;
                noCapability.rules = [
                    {
                        id: "fixture-all-abstain",
                        when: {
                            op: "exists",
                            left: { kind: "path", path: "input.taskFamily" },
                        },
                        steps: [
                            { kind: "abstain", reason: "Fixture intentionally provides no useful capability." },
                        ],
                        provenance: [organization.evidence[0].id],
                    },
                ];
                noCapability.provenance = [organization.evidence[0].id];
                value = noCapability;
            }
            else {
                value = organization.oracleWorkflow;
            }
        }
        return {
            text: JSON.stringify(value),
            usage: {
                inputTokens: 10,
                outputTokens: 10,
                totalTokens: 20,
                latencyMs: 1,
                costUsd: 0,
            },
        };
    },
};
const retryGateway = new JsonModelGateway(retryBackend, new BudgetTracker({
    maxAdaptationCalls: 4,
    maxTaskCallsPerCase: 1,
    maxTotalInputTokens: 10_000,
    maxTotalOutputTokens: 10_000,
    maxCostUsd: 1,
}), new FileModelCache(path.join(process.cwd(), "runs", `gate-methods-${process.pid}-${Date.now()}-retry`)));
const retryResult = await runCheckpoint(new OrgBootCondition(retryGateway), organization, organization.evidence.length, 0);
assert.equal(retryWorkflowCalls, 2);
assert.equal(retryResult.state.candidateWorkflows.length, 2);
assert.equal(retryResult.state.activeWorkflows.length, 1);
assert.equal(retryResult.verifiedAutomationCoverage, 1);
assert.ok(retryResult.state.audit.some((event) => event.kind === "workflow_rejected"));
const subsetBackend = {
    descriptor: { provider: "fixture", id: "safe-subset", temperature: 0 },
    complete: async (request) => {
        const isClaimRequest = request.userPrompt.includes('"outputContract"');
        let value;
        if (isClaimRequest) {
            value = {
                claims: [
                    {
                        id: `${organization.id}-subset-claim`,
                        subject: organization.id,
                        predicate: "has_visible_evidence",
                        object: true,
                        scope: "fixture-only",
                        confidence: 1,
                        provenance: [organization.evidence[0].id],
                        status: "active",
                    },
                ],
            };
        }
        else {
            const bundled = structuredClone(organization.oracleWorkflow);
            bundled.id = `${bundled.id}-with-unsafe-broad-rule`;
            const automaticRule = bundled.rules.find((rule) => rule.id === "standard-within-limit");
            assert.ok(automaticRule);
            bundled.rules = [
                {
                    id: "fixture-unsafe-broad-rule",
                    when: {
                        op: "exists",
                        left: { kind: "path", path: "input.taskFamily" },
                    },
                    steps: structuredClone(automaticRule.steps),
                    provenance: structuredClone(automaticRule.provenance),
                },
                ...bundled.rules,
            ];
            value = bundled;
        }
        return {
            text: JSON.stringify(value),
            usage: {
                inputTokens: 10,
                outputTokens: 10,
                totalTokens: 20,
                latencyMs: 1,
                costUsd: 0,
            },
        };
    },
};
const subsetResult = await runCheckpoint(new OrgBootCondition(new JsonModelGateway(subsetBackend, new BudgetTracker({
    maxAdaptationCalls: 4,
    maxTaskCallsPerCase: 1,
    maxTotalInputTokens: 10_000,
    maxTotalOutputTokens: 10_000,
    maxCostUsd: 1,
}), new FileModelCache(path.join(process.cwd(), "runs", `gate-methods-${process.pid}-${Date.now()}-safe-subset`)))), organization, organization.evidence.length, 0);
assert.equal(subsetResult.verifiedAutomationCoverage, 1);
assert.equal(subsetResult.state.candidateWorkflows[0]?.rules.length, 5);
assert.equal(subsetResult.state.activeWorkflows[0]?.rules.length, 4);
assert.ok(subsetResult.state.audit.some((event) => event.kind === "workflow_promoted" && event.reason?.includes("4/5 safe rules")));
console.log(JSON.stringify({
    gate: "method-plumbing",
    summaries,
    aggregatePromotionRetry: true,
    safeSubsetPromotion: true,
    scientificResult: false,
    note: "Oracle-shaped fixture outputs validate plumbing only and are excluded from research claims.",
    paidModelRequestMade: false,
}, null, 2));
//# sourceMappingURL=gate-methods.js.map