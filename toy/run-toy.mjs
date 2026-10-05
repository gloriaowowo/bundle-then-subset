#!/usr/bin/env node
// Fully public mechanism reproducer. Two miniature organizations, two blind
// verifier designs, two candidate styles; every input (including the hidden
// panels) is published in this directory. Zero model calls, deterministic.
//
// Reproduces, end to end:
//   1. Bundle accepts each candidate on the blind development panel.
//   2. Safe-Subset prunes the blind rule from the accepted bundle
//      (Proposition 1: blind-stratum pruning).
//   3. Hidden coverage under the pruned artifact drops by exactly the blind
//      stratum's task share when surviving rules guard the blind behavior
//      (benign shape), and produces policy violations when a rule relied on
//      rule order instead (violating shape).
//   4. BTS preserves the accepted bundle in every case.
import assert from "node:assert/strict";

import { applyReleaseGate, RELEASE_GATES } from "../experiments/v05_stress/gates.mjs";
import { evaluateWorkflowAggregate } from "../experiments/v05_stress/outcomes.mjs";
import {
  createToyOrganization,
  guardedCandidate,
  orderDependentCandidate,
} from "./toy-benchmark.mjs";

const SCENARIOS = [
  { organization: "toy-expense-maple", design: "approval-blind", candidate: "guarded", blindRule: "approval-over-limit", expectedShape: "benign" },
  { organization: "toy-access-cedar", design: "approval-blind", candidate: "guarded", blindRule: "approval-over-limit", expectedShape: "benign" },
  { organization: "toy-expense-maple", design: "escalation-blind", candidate: "order-dependent", blindRule: "ineligible-escalate", expectedShape: "violating" },
  { organization: "toy-access-cedar", design: "escalation-blind", candidate: "order-dependent", blindRule: "ineligible-escalate", expectedShape: "violating" },
];

const rows = [];
for (const scenario of SCENARIOS) {
  const organization = createToyOrganization(scenario.organization, scenario.design);
  const candidate = scenario.candidate === "guarded"
    ? guardedCandidate(organization)
    : orderDependentCandidate(organization);

  const gates = {};
  for (const gate of RELEASE_GATES) {
    const decision = applyReleaseGate(
      candidate, gate, organization.developmentTasks, organization.tools, organization.evidenceIds,
    );
    const evaluated = evaluateWorkflowAggregate({
      candidate,
      activeWorkflow: decision.activeWorkflow,
      tasks: organization.hiddenTasks,
      visibleEvidence: organization.evidence,
      tools: organization.tools,
      idSuffix: `${gate}-toy`,
    });
    gates[gate] = { decision, evaluated };
  }

  // 1. The blind development panel accepts the complete bundle.
  assert.ok(gates.bundle.decision.activeWorkflow, "bundle must accept on the blind panel");

  // 2. Proposition 1 in action: the blind rule is pruned from the accepted bundle.
  const keptRuleIds = new Set(gates["safe-subset"].decision.activeWorkflow.rules.map((rule) => rule.id));
  assert.ok(!keptRuleIds.has(scenario.blindRule), `safe-subset must prune ${scenario.blindRule}`);
  const prunedRuleIds = candidate.rules.map((rule) => rule.id).filter((id) => !keptRuleIds.has(id));

  // 3. Exposure shape on the published hidden panel.
  const blindField = scenario.design === "approval-blind" ? "approval" : "escalation";
  const blindShare = organization.hiddenTasks.filter((task) =>
    (blindField === "approval" ? task.requiredApprovals.length > 0 : task.requiredEvents.some((event) => event.kind === "escalation"))).length
    / organization.hiddenTasks.length;
  const bundleCoverage = gates.bundle.evaluated.verifiedAutomationCoverage;
  const subsetCoverage = gates["safe-subset"].evaluated.verifiedAutomationCoverage;
  const subsetViolations = gates["safe-subset"].evaluated.policyFailureCount;
  const bundleViolations = gates.bundle.evaluated.policyFailureCount;
  assert.equal(bundleViolations, 0, "the accepted bundle commits no violation on the toy hidden panel");
  if (scenario.expectedShape === "benign") {
    assert.ok(Math.abs((bundleCoverage - subsetCoverage) - blindShare) < 1e-9,
      "benign shape: coverage loss equals the blind stratum share exactly");
    assert.equal(subsetViolations, 0, "benign shape: no violation");
  } else {
    assert.ok(subsetViolations > 0, "violating shape: pruned artifact commits policy violations");
  }

  // 4. BTS preserves the accepted bundle.
  assert.equal(gates["bundle-then-subset"].decision.route, "bundle_accepted");
  assert.deepEqual(
    gates["bundle-then-subset"].decision.activeWorkflow.rules.map((rule) => rule.id),
    candidate.rules.map((rule) => rule.id),
    "BTS releases the accepted bundle unchanged",
  );

  rows.push({
    organization: scenario.organization,
    design: scenario.design,
    candidate: scenario.candidate,
    prunedBySafeSubset: prunedRuleIds,
    blindHiddenShare: blindShare,
    hiddenCoverage: { bundle: bundleCoverage, safeSubset: subsetCoverage, bts: gates["bundle-then-subset"].evaluated.verifiedAutomationCoverage },
    hiddenPolicyViolations: { bundle: bundleViolations, safeSubset: subsetViolations, bts: gates["bundle-then-subset"].evaluated.policyFailureCount },
    shape: scenario.expectedShape,
  });
}

console.log(JSON.stringify({ status: "toy-mechanism-reproduced", scenarios: rows }, null, 2));
console.log("\nAll four scenarios reproduce the mechanism: Bundle accepts on the blind panel;");
console.log("Safe-Subset prunes the blind rule from every accepted bundle (Proposition 1);");
console.log("the exposure is benign exactly where surviving rules guard the blind behavior");
console.log("and violating where a rule relied on rule order; BTS preserves every accepted bundle.");
