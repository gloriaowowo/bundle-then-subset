#!/usr/bin/env node
// POST-HOC analysis, added for the camera-ready in response to reviews (CLEA #74:
// "what does keeping the whole accepted bundle cost?"). ZERO MODEL CALLS: stored
// candidates are replayed through each arm's frozen release gates, simulator and
// grader; every reconstructed active workflow is checked against the stored hash.
//
// For every arm it reports, on the units where the full bundle was accepted
// (the only units where Bundle/BTS and Safe-Subset can release different
// artifacts):
//   * released rules (Bundle = BTS vs Safe-Subset) and the rules Safe-Subset prunes;
//   * first-match condition evaluations and tool calls per hidden task, on the
//     SAME (matched) accepted units for both gates, task- and unit-weighted;
//   * the share of hidden tasks matched by more than one rule, on matched units;
//   * pre-emption: hidden tasks on which a retained rule fires before a rule
//     that Safe-Subset kept (i.e. both gates match, but different rules);
//   * what the retained-but-prunable rules do on hidden tasks (per-firing
//     grades, and the Bundle-minus-Safe-Subset outcome-class difference from
//     the stored, hash-checked aggregates);
//   * DEAD rules: accepted-bundle rules that match no verifier case and no
//     hidden case even when executed alone (single-rule workflow).
// Not measured: latency, memory, or rule interactions beyond first-match order.
//
// Ported from the camera-ready analysis workspace (exec-cost.mjs,
// natural-blind.mjs, plus the isolated-execution dead-rule check).
// Requires `npm run build` (dist/).
//
// Output: research/retention_cost_accounting.json
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { gradeTrace } from "../dist/eval/grader.js";
import { hashArtifact } from "../dist/eval/manifest.js";
import { evaluateExpression } from "../dist/simulator/expression.js";
import { executeWorkflow } from "../dist/simulator/workflow.js";

const OUTPUT_PATH = "research/retention_cost_accounting.json";
const ARMS = [
  { key: "v03_deepseek", experiment: "v03", runSet: "research/robustness_v03_deepseek-deepseek-v4-pro_hidden_run_set.json", regimes: true },
  { key: "v03c_gemini", experiment: "v03c", runSet: "research/robustness_v03c_google-vertex-gemini-3.7-flash_hidden_run_set.json", regimes: true },
  { key: "v05_deepseek", experiment: "v05_stress", runSet: "research/robustness_v05_stress_deepseek-deepseek-v4-pro_hidden_run_set.json", regimes: false },
  { key: "v05b_deepseek", experiment: "v05b_stress", runSet: "research/robustness_v05b_stress_deepseek-deepseek-v4-pro_hidden_run_set.json", regimes: false },
  { key: "v05g_gemini", experiment: "v05g_stress", runSet: "research/robustness_v05g_stress_google-vertex-gemini-3.7-flash_hidden_run_set.json", regimes: false },
  { key: "v05bg_gemini", experiment: "v05bg_stress", runSet: "research/robustness_v05bg_stress_google-vertex-gemini-3.7-flash_hidden_run_set.json", regimes: false },
];
const GATES = ["direct", "bundle", "safe-subset", "bundle-then-subset"];
const EPS = 1e-12;

const ROOT = process.cwd();
const readJson = async (file) => JSON.parse(await readFile(path.join(ROOT, file), "utf8"));
const sum = (values) => values.reduce((s, v) => s + v, 0);
const mean = (values) => sum(values) / values.length;
const ctx = (task) => ({ input: task.input, state: task.initialState, claims: {}, events: [], actorRole: task.actorRole });

// First-match execution cost of one workflow on one task.
function taskCost(workflow, task, tools) {
  const execution = executeWorkflow(workflow, task, tools);
  const triggered = evaluateExpression(workflow.trigger, ctx(task));
  const index = execution.matchedRuleId ? workflow.rules.findIndex((r) => r.id === execution.matchedRuleId) : -1;
  const matching = triggered ? workflow.rules.filter((r) => evaluateExpression(r.when, ctx(task))).map((r) => r.id) : [];
  return {
    execution,
    matched: execution.matchedRuleId ?? null,
    conditionEvals: !triggered ? 0 : index >= 0 ? index + 1 : workflow.rules.length,
    toolCalls: execution.trace.events.filter((e) => e.kind === "tool").length,
    matchingCount: matching.length,
  };
}
const soloWorkflow = (workflow, rule) => ({ ...structuredClone(workflow), rules: [structuredClone(rule)] });
const firesAlone = (workflow, rule, tasks, tools) =>
  tasks.some((t) => executeWorkflow(soloWorkflow(workflow, rule), t, tools).matchedRuleId === rule.id);
const matchesByExpression = (rule, tasks) => tasks.some((t) => evaluateExpression(rule.when, ctx(t)));

const report = {
  schemaVersion: 1,
  scientificStatus: "post-hoc-camera-ready-retention-cost-accounting",
  addedFor: "Camera-ready response to reviews (CLEA #74); not part of any preregistered protocol.",
  modelCalls: 0,
  providerCostUsd: 0,
  definitions: {
    acceptedUnits: "Candidate units whose complete bundle passed the full eight-case verifier; Bundle and BTS release the bundle, Safe-Subset releases its tie-broken minimal subset.",
    retainedPrunableRules: "Rules kept by Bundle/BTS on accepted units that Safe-Subset drops.",
    conditionEvals: "Rule conditions evaluated under first-match semantics until a rule fires (0 if the trigger does not fire).",
    multiMatchShare: "Share of hidden tasks for which more than one released rule's condition holds, computed on the same accepted units for both gates.",
    preemption: "Hidden task on which Bundle and Safe-Subset both fire a rule but a different one, i.e. a retained rule fires before a rule Safe-Subset kept.",
    verifierUnmatchedRule: "Accepted-bundle rule whose condition holds on no verifier (development) case.",
    deadRule: "Verifier-unmatched rule that also matches no hidden case when executed alone as a single-rule workflow.",
    firingsPolicySafeNonPass: "Hidden firings that pass policy and grounding but are not automated passes (grader functionalPass false: incorrect escalations/approval requests, abstentions, functional action failures). The paper's outcome anatomy uses outcomeClassBundleMinusSafeSubset instead.",
    unitWeighted: "Mean over units of the per-unit mean over hidden tasks.",
  },
  notMeasured: ["wall-clock latency", "memory", "rule interactions beyond first-match order"],
  arms: {},
};

for (const arm of ARMS) {
  const { createOrganizations } = await import(`../experiments/${arm.experiment}/benchmark.mjs`);
  const { applyReleaseGate } = await import(`../experiments/${arm.experiment}/gates.mjs`);
  const runSet = await readJson(arm.runSet);
  const orgCache = new Map();
  const orgFor = (regime, id) => {
    const key = `${regime}:${id}`;
    if (!orgCache.has(key)) orgCache.set(key, createOrganizations(regime).find((o) => o.id === id));
    return orgCache.get(key);
  };

  const allUnits = Object.fromEntries(GATES.map((g) => [g, { activeUnits: 0, releasedRules: 0, hiddenTasks: 0, conditionEvals: 0, toolCalls: 0, multiMatchTasks: 0 }]));
  const matched = Object.fromEntries(["bundle", "safe-subset"].map((g) => [g, { releasedRules: 0, hiddenTasks: 0, conditionEvals: 0, toolCalls: 0, multiMatchTasks: 0, unitMeanConditionEvals: [], unitMeanToolCalls: [] }]));
  const interference = { hiddenTasksOnAcceptedUnits: 0, tasksWithDifferentFiredRule: 0, bundleFiresSafeSubsetNoMatch: 0, bothFireDifferentRule: 0 };
  const retained = {
    prunedUnits: 0, rules: 0, verifierMatching: 0, verifierUnmatched: 0, deadAmongPruned: 0,
    hiddenFirings: 0, firingsAutomatedPass: 0, firingsPolicyFailure: 0, firingsGroundingFailure: 0,
    firingsPolicySafeNonPass: 0, firingsOtherNonPass: 0,
    outcomeClassBundleMinusSafeSubset: {},
    prunedUnitsWithVacChange: 0, prunedUnitsWithScChange: 0, prunedUnitsWithPolicyFailureChange: 0,
  };
  const unmatched = { acceptedUnitsWithVerifierUnmatchedRule: 0, verifierUnmatchedRules: 0, verifierUnmatchedRulesIsolatedExec: 0, deadRules: 0, verifierUnmatchedRulesFiringOnHidden: 0, hiddenFiringsOfVerifierUnmatchedRules: 0, hiddenFiringsOfVerifierUnmatchedRulesAutomatedPass: 0 };
  const confusion = { truePositive: 0, trueNegative: 0, falsePositive: 0, falseNegative: 0 };
  let candidateUnits = 0;
  let acceptedUnits = 0;
  let hashMismatches = 0;

  for (const runId of runSet.runIds) {
    if (!/^[a-zA-Z0-9._-]+$/.test(runId)) throw new Error(`Unsafe run ID ${runId}.`);
    const [aggregate, artifacts, manifest] = await Promise.all([
      readJson(`runs/${runId}/aggregate.json`),
      readJson(`runs/${runId}/artifacts.json`),
      readJson(`runs/${runId}/manifest.json`),
    ]);
    if (manifest.hashes.aggregate !== hashArtifact(aggregate) || manifest.hashes.artifacts !== hashArtifact(artifacts)) {
      throw new Error(`Manifest hash mismatch in ${runId}.`);
    }
    if (!aggregate.candidateGenerated || !artifacts.candidate) continue;
    const candidate = artifacts.candidate;
    candidateUnits += 1;
    const org = orgFor(arm.regimes ? aggregate.evidenceRegime : "gap-0", aggregate.organizationId);
    const evidenceIds = new Set(org.evidence.slice(0, aggregate.checkpoint).map((e) => e.id));
    const stored = Object.fromEntries(aggregate.gateEvaluations.map((e) => [e.gate, e]));
    const active = {};
    for (const gate of GATES) {
      const decision = applyReleaseGate(candidate, gate, org.developmentTasks, org.tools, evidenceIds);
      active[gate] = decision.activeWorkflow;
      const hash = decision.activeWorkflow ? hashArtifact(decision.activeWorkflow) : undefined;
      if (hash !== stored[gate].promotion.activeWorkflowHash) hashMismatches += 1;
    }
    const isAccepted = Boolean(active.bundle);
    const hiddenSafeUseful = stored.direct.verifiedAutomationCoverage > 0 &&
      stored.direct.policyPassRate === 1 && stored.direct.groundingPassRate === 1;
    confusion[isAccepted ? (hiddenSafeUseful ? "truePositive" : "falsePositive") : (hiddenSafeUseful ? "falseNegative" : "trueNegative")] += 1;

    const costs = {};
    for (const gate of GATES) {
      const wf = active[gate];
      if (!wf) continue;
      costs[gate] = org.hiddenTasks.map((t) => taskCost(wf, t, org.tools));
      const a = allUnits[gate];
      a.activeUnits += 1;
      a.releasedRules += wf.rules.length;
      for (const c of costs[gate]) {
        a.hiddenTasks += 1; a.conditionEvals += c.conditionEvals; a.toolCalls += c.toolCalls;
        if (c.matchingCount > 1) a.multiMatchTasks += 1;
      }
    }
    if (!isAccepted) continue;
    acceptedUnits += 1;
    const bundleWf = active.bundle;
    const subsetWf = active["safe-subset"];
    if (!subsetWf) throw new Error(`Accepted unit without Safe-Subset release in ${runId}.`);

    for (const gate of ["bundle", "safe-subset"]) {
      const m = matched[gate];
      m.releasedRules += active[gate].rules.length;
      for (const c of costs[gate]) {
        m.hiddenTasks += 1; m.conditionEvals += c.conditionEvals; m.toolCalls += c.toolCalls;
        if (c.matchingCount > 1) m.multiMatchTasks += 1;
      }
      m.unitMeanConditionEvals.push(mean(costs[gate].map((c) => c.conditionEvals)));
      m.unitMeanToolCalls.push(mean(costs[gate].map((c) => c.toolCalls)));
    }
    costs.bundle.forEach((b, i) => {
      const s = costs["safe-subset"][i];
      interference.hiddenTasksOnAcceptedUnits += 1;
      if (b.matched !== s.matched) {
        interference.tasksWithDifferentFiredRule += 1;
        if (b.matched && !s.matched) interference.bundleFiresSafeSubsetNoMatch += 1;
        if (b.matched && s.matched) interference.bothFireDifferentRule += 1;
      }
    });

    // Verifier-unmatched and dead rules in the accepted bundle.
    const unmatchedRules = bundleWf.rules.filter((r) => !matchesByExpression(r, org.developmentTasks));
    const unmatchedIsolated = bundleWf.rules.filter((r) => !firesAlone(bundleWf, r, org.developmentTasks, org.tools));
    if (unmatchedRules.length) unmatched.acceptedUnitsWithVerifierUnmatchedRule += 1;
    unmatched.verifierUnmatchedRules += unmatchedRules.length;
    unmatched.verifierUnmatchedRulesIsolatedExec += unmatchedIsolated.length;
    const firedCount = new Map();
    const firedPass = new Map();
    const firingGrades = new Map();
    costs.bundle.forEach((c, i) => {
      if (!c.matched) return;
      const task = org.hiddenTasks[i];
      const grade = gradeTrace(task, c.execution.trace, c.execution.finalState, bundleWf, evidenceIds);
      firedCount.set(c.matched, (firedCount.get(c.matched) ?? 0) + 1);
      firedPass.set(c.matched, (firedPass.get(c.matched) ?? 0) + (grade.automatedPass ? 1 : 0));
      const list = firingGrades.get(c.matched) ?? [];
      list.push(grade);
      firingGrades.set(c.matched, list);
    });
    const isDead = (rule) => !matchesByExpression(rule, org.developmentTasks) &&
      !firesAlone(bundleWf, rule, org.developmentTasks, org.tools) &&
      !firesAlone(bundleWf, rule, org.hiddenTasks, org.tools);
    for (const rule of unmatchedRules) {
      if (isDead(rule)) unmatched.deadRules += 1;
      const fired = firedCount.get(rule.id) ?? 0;
      if (fired) unmatched.verifierUnmatchedRulesFiringOnHidden += 1;
      unmatched.hiddenFiringsOfVerifierUnmatchedRules += fired;
      unmatched.hiddenFiringsOfVerifierUnmatchedRulesAutomatedPass += firedPass.get(rule.id) ?? 0;
    }

    // Retained-but-prunable rules.
    const kept = new Set(subsetWf.rules.map((r) => r.id));
    const dropped = bundleWf.rules.filter((r) => !kept.has(r.id));
    if (!dropped.length) continue;
    retained.prunedUnits += 1;
    retained.rules += dropped.length;
    for (const rule of dropped) {
      if (matchesByExpression(rule, org.developmentTasks)) retained.verifierMatching += 1;
      else retained.verifierUnmatched += 1;
      if (isDead(rule)) retained.deadAmongPruned += 1;
      for (const grade of firingGrades.get(rule.id) ?? []) {
        retained.hiddenFirings += 1;
        if (grade.automatedPass) retained.firingsAutomatedPass += 1;
        else if (!grade.policyPass) retained.firingsPolicyFailure += 1;
        else if (!grade.groundingPass) retained.firingsGroundingFailure += 1;
        else if (!grade.functionalPass) retained.firingsPolicySafeNonPass += 1;
        else retained.firingsOtherNonPass += 1;
      }
    }
    const b = stored.bundle;
    const s = stored["safe-subset"];
    for (const [k, v] of Object.entries(b.outcomeCounts)) {
      retained.outcomeClassBundleMinusSafeSubset[k] = (retained.outcomeClassBundleMinusSafeSubset[k] ?? 0) + v - s.outcomeCounts[k];
    }
    if (Math.abs(b.verifiedAutomationCoverage - s.verifiedAutomationCoverage) > EPS) retained.prunedUnitsWithVacChange += 1;
    if (Math.abs(b.safetyConstrainedVac - s.safetyConstrainedVac) > EPS) retained.prunedUnitsWithScChange += 1;
    if (b.policyFailureCount !== s.policyFailureCount) retained.prunedUnitsWithPolicyFailureChange += 1;
  }
  if (hashMismatches !== 0) throw new Error(`${arm.key}: ${hashMismatches} reconstructed gate decisions disagree with stored hashes.`);
  retained.outcomeClassBundleMinusSafeSubset = Object.fromEntries(
    Object.entries(retained.outcomeClassBundleMinusSafeSubset).filter(([, v]) => v !== 0));

  const perGateAll = Object.fromEntries(GATES.map((g) => {
    const a = allUnits[g];
    return [g, { ...a,
      meanConditionEvalsPerHiddenTask: a.conditionEvals / a.hiddenTasks,
      meanToolCallsPerHiddenTask: a.toolCalls / a.hiddenTasks,
      multiMatchShare: a.multiMatchTasks / a.hiddenTasks }];
  }));
  const perGateMatched = Object.fromEntries(["bundle", "safe-subset"].map((g) => {
    const m = matched[g];
    return [g, {
      releasedRules: m.releasedRules,
      hiddenTasks: m.hiddenTasks,
      conditionEvals: m.conditionEvals,
      toolCalls: m.toolCalls,
      multiMatchTasks: m.multiMatchTasks,
      conditionEvalsPerTaskTaskWeighted: m.conditionEvals / m.hiddenTasks,
      conditionEvalsPerTaskUnitWeighted: mean(m.unitMeanConditionEvals),
      toolCallsPerTaskTaskWeighted: m.toolCalls / m.hiddenTasks,
      toolCallsPerTaskUnitWeighted: mean(m.unitMeanToolCalls),
      multiMatchShare: m.multiMatchTasks / m.hiddenTasks,
    }];
  }));
  const mb = perGateMatched.bundle;
  const ms = perGateMatched["safe-subset"];
  report.arms[arm.key] = {
    candidateUnits,
    acceptedUnits,
    activeHashMismatchesVsStored: hashMismatches,
    fullVerifierConfusion: confusion,
    acceptedUnitsMatched: {
      ...perGateMatched,
      extraRules: mb.releasedRules - ms.releasedRules,
      extraRulesRelative: mb.releasedRules / ms.releasedRules - 1,
      conditionEvalsRelativeUnitWeighted: mb.conditionEvalsPerTaskUnitWeighted / ms.conditionEvalsPerTaskUnitWeighted - 1,
      conditionEvalsRelativeTaskWeighted: mb.conditionEvalsPerTaskTaskWeighted / ms.conditionEvalsPerTaskTaskWeighted - 1,
      toolCallsRelativeUnitWeighted: mb.toolCallsPerTaskUnitWeighted / ms.toolCallsPerTaskUnitWeighted - 1,
    },
    preemption: interference,
    retainedPrunableRules: retained,
    verifierUnmatchedAndDeadRules: unmatched,
    allCandidateUnitsByGate: perGateAll,
  };
  process.stderr.write(`${arm.key}: ${candidateUnits} candidate units, ${acceptedUnits} accepted, hash mismatches ${hashMismatches}\n`);
}

await writeFile(path.join(ROOT, OUTPUT_PATH), `${JSON.stringify(report, null, 2)}\n`, "utf8");
for (const [key, a] of Object.entries(report.arms)) {
  const m = a.acceptedUnitsMatched;
  const r = a.retainedPrunableRules;
  const u = a.verifierUnmatchedAndDeadRules;
  process.stdout.write(`== ${key}: accepted ${a.acceptedUnits}/${a.candidateUnits}; confusion ${JSON.stringify(a.fullVerifierConfusion)}\n` +
    `   rules ${m.bundle.releasedRules} vs ${m["safe-subset"].releasedRules} (+${m.extraRules}, ${(100 * m.extraRulesRelative).toFixed(1)}%), pruned units ${r.prunedUnits}\n` +
    `   cond/task unit-w ${m.bundle.conditionEvalsPerTaskUnitWeighted.toFixed(3)} vs ${m["safe-subset"].conditionEvalsPerTaskUnitWeighted.toFixed(3)} (${(100 * m.conditionEvalsRelativeUnitWeighted).toFixed(1)}%); task-w ${m.bundle.conditionEvalsPerTaskTaskWeighted.toFixed(3)} vs ${m["safe-subset"].conditionEvalsPerTaskTaskWeighted.toFixed(3)}\n` +
    `   multi-match ${(100 * m.bundle.multiMatchShare).toFixed(1)}% vs ${(100 * m["safe-subset"].multiMatchShare).toFixed(1)}% of ${m.bundle.hiddenTasks}; preemption ${a.preemption.bothFireDifferentRule}/${a.preemption.hiddenTasksOnAcceptedUnits}\n` +
    `   retained rules ${r.rules}: firings ${r.hiddenFirings}, pass ${r.firingsAutomatedPass}, policy fail ${r.firingsPolicyFailure}, policy-safe non-pass ${r.firingsPolicySafeNonPass}; outcome diff ${JSON.stringify(r.outcomeClassBundleMinusSafeSubset)}; VAC/SC changes ${r.prunedUnitsWithVacChange}/${r.prunedUnitsWithScChange}\n` +
    `   verifier-unmatched rules ${u.verifierUnmatchedRules} (isolated ${u.verifierUnmatchedRulesIsolatedExec}) in ${u.acceptedUnitsWithVerifierUnmatchedRule} units; dead ${u.deadRules}; firing on hidden ${u.verifierUnmatchedRulesFiringOnHidden}\n`);
}
