#!/usr/bin/env node
// Post-hoc Max-Subset baseline (review-panel control): exact subset search with
// the SAME safety constraints and pass-maximization as Safe-Subset, but ties
// broken toward MORE rules instead of fewer. Zero provider calls: stored
// candidates are replayed through the frozen deterministic gate/eval code.
// Answers: is the over-pruning failure a property of subset search per se, or
// of the fewer-rules tie-break? And where does BTS still differ (evaluation
// count; rejected-path recovery granularity)?
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { gradeTrace } from "../dist/eval/grader.js";
import { executeWorkflow } from "../dist/simulator/workflow.js";

const ROOT = process.cwd();
const readJson = async (file) => JSON.parse(await readFile(path.join(ROOT, file), "utf8"));

const ARMS = [
  { key: "v03_deepseek", experiment: "v03", runSet: "research/robustness_v03_deepseek-deepseek-v4-pro_hidden_run_set.json", regimes: true },
  { key: "v03c_gemini", experiment: "v03c", runSet: "research/robustness_v03c_google-vertex-gemini-3.7-flash_hidden_run_set.json", regimes: true },
  { key: "v05_deepseek", experiment: "v05_stress", runSet: "research/robustness_v05_stress_deepseek-deepseek-v4-pro_hidden_run_set.json", regimes: false },
  { key: "v05b_deepseek", experiment: "v05b_stress", runSet: "research/robustness_v05b_stress_deepseek-deepseek-v4-pro_hidden_run_set.json", regimes: false },
  { key: "v05g_gemini", experiment: "v05g_stress", runSet: "research/robustness_v05g_stress_google-vertex-gemini-3.7-flash_hidden_run_set.json", regimes: false },
  { key: "v05bg_gemini", experiment: "v05bg_stress", runSet: "research/robustness_v05bg_stress_google-vertex-gemini-3.7-flash_hidden_run_set.json", regimes: false },
];

const WEIGHTS = new Map([[0, 4 / 32], [8, 8 / 32], [16, 8 / 32], [24, 8 / 32], [32, 4 / 32]]);
// Stress arms: evidence-complete checkpoints (same set as scripts/summarize-v05*-stress.mjs).
const EVIDENCE_COMPLETE = new Set([16, 24, 32]);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function gradeWorkflow(workflow, tasks, tools, evidenceIds) {
  return tasks.map((task) => {
    const execution = executeWorkflow(workflow, task, tools);
    return gradeTrace(task, execution.trace, execution.finalState, workflow, evidenceIds);
  });
}

// Identical to the frozen exact search except the tie-break direction.
function applyMaxSubsetGate(candidate, developmentTasks, tools, evidenceIds) {
  if (!candidate) return { activeWorkflow: undefined, subsetsEvaluated: 0 };
  if (candidate.rules.length > 8) throw new Error("Exact search supports at most eight rules.");
  let bestWorkflow;
  let bestPasses = 0;
  let subsetsEvaluated = 0;
  const subsetCount = 2 ** candidate.rules.length;
  for (let mask = 1; mask < subsetCount; mask += 1) {
    subsetsEvaluated += 1;
    const trial = structuredClone(candidate);
    trial.rules = candidate.rules
      .filter((_, index) => (mask & (1 << index)) !== 0)
      .map((rule) => structuredClone(rule));
    const trialGrades = gradeWorkflow(trial, developmentTasks, tools, evidenceIds);
    const safe = trialGrades.every((grade) => grade.policyPass && grade.groundingPass);
    if (!safe) continue;
    const passes = trialGrades.filter((grade) => grade.automatedPass).length;
    if (passes > bestPasses ||
        (passes === bestPasses && passes > 0 && (!bestWorkflow || trial.rules.length > bestWorkflow.rules.length))) {
      bestWorkflow = trial;
      bestPasses = passes;
    }
  }
  const selected = bestPasses > 0 ? bestWorkflow : undefined;
  if (selected) selected.status = "active";
  return { activeWorkflow: selected, subsetsEvaluated };
}

const report = { schemaVersion: 1, scientificStatus: "post-hoc-max-subset-baseline", modelCalls: 0, arms: {} };

for (const arm of ARMS) {
  const { createOrganizations } = await import(`../experiments/${arm.experiment}/benchmark.mjs`);
  const { evaluateWorkflowAggregate } = await import(`../experiments/${arm.experiment}/outcomes.mjs`);
  const runSet = await readJson(arm.runSet);
  const organizationCache = new Map();
  const organizationFor = (regime, organizationId) => {
    const cacheKey = `${regime}:${organizationId}`;
    if (!organizationCache.has(cacheKey)) {
      organizationCache.set(cacheKey, createOrganizations(regime).find((item) => item.id === organizationId));
    }
    return organizationCache.get(cacheKey);
  };

  const perGateAuc = { bundle: new Map(), "safe-subset": new Map(), "bundle-then-subset": new Map(), "max-subset": new Map() };
  let acceptedUnits = 0;
  let maxEqualsBundleOnAccepted = 0;
  let maxPrunedOnAccepted = 0;
  let rejectedUnits = 0;
  let maxRecoveredOnRejected = 0;
  let btsRecoveredOnRejected = 0;
  let maxViolations = 0;
  let maxViolationsAccepted = 0;
  let subsetsEvaluatedTotal = 0;
  const completeLossByOrganization = {};

  for (const runId of runSet.runIds) {
    const [aggregate, artifacts] = await Promise.all([
      readJson(`runs/${runId}/aggregate.json`),
      readJson(`runs/${runId}/artifacts.json`),
    ]);
    const regime = arm.regimes ? aggregate.evidenceRegime : "gap-0";
    const organization = organizationFor(regime, aggregate.organizationId);
    if (!organization) throw new Error(`Unknown organization ${aggregate.organizationId}`);
    const visibleEvidence = organization.evidence.slice(0, aggregate.checkpoint);
    const evidenceIds = new Set(visibleEvidence.map((item) => item.id));
    const candidate = aggregate.candidateGenerated ? artifacts.candidate : undefined;

    const decision = applyMaxSubsetGate(candidate, organization.developmentTasks, organization.tools, evidenceIds);
    subsetsEvaluatedTotal += decision.subsetsEvaluated;
    const evaluated = evaluateWorkflowAggregate({
      candidate,
      activeWorkflow: decision.activeWorkflow,
      tasks: organization.hiddenTasks,
      visibleEvidence,
      tools: organization.tools,
      idSuffix: "max-subset-posthoc",
    });

    const gates = Object.fromEntries(aggregate.gateEvaluations.map((entry) => [entry.gate, entry]));
    const bundleAccepted = (gates.bundle.promotion?.promotedRuleCount ?? 0) > 0
      || (artifacts.gateDecisions?.find((entry) => (entry.id ?? entry.gate) === "bundle")?.promotion?.promotedRuleCount ?? 0) > 0;

    maxViolations += evaluated.policyFailureCount;
    if (candidate && bundleAccepted) {
      acceptedUnits += 1;
      const sameRuleCount = decision.activeWorkflow && decision.activeWorkflow.rules.length === candidate.rules.length;
      if (sameRuleCount) maxEqualsBundleOnAccepted += 1;
      else maxPrunedOnAccepted += 1;
      maxViolationsAccepted += evaluated.policyFailureCount;
      // Camera-ready (post-hoc, stored gate results only): per-unit Bundle minus
      // Safe-Subset hidden coverage at evidence-complete checkpoints, so the paper's
      // design-constant coverage loss (per arm and per domain) is a \CR macro.
      if (!arm.regimes && EVIDENCE_COMPLETE.has(aggregate.checkpoint)) {
        (completeLossByOrganization[aggregate.organizationId] ??= []).push(
          gates.bundle.verifiedAutomationCoverage - gates["safe-subset"].verifiedAutomationCoverage);
      }
    } else if (candidate && !bundleAccepted) {
      rejectedUnits += 1;
      if (decision.activeWorkflow) maxRecoveredOnRejected += 1;
      const btsRoute = artifacts.gateDecisions?.find((entry) => (entry.id ?? entry.gate) === "bundle-then-subset")?.route
        ?? gates["bundle-then-subset"].promotion?.route;
      if (btsRoute === "subset_recovery" || (gates["bundle-then-subset"].promotion?.promotedRuleCount ?? 0) > 0) btsRecoveredOnRejected += 1;
    }

    // A seed series is (organization, evidence regime, seed). Camera-ready fix: the
    // key previously omitted evidenceRegime, so the four v0.3/v0.3c regimes were
    // summed into one series and those arms' scVacAucClusterMeans were 4x too
    // large. Single-regime stress arms are unaffected.
    const seriesKey = `${aggregate.organizationId}:${aggregate.evidenceRegime}:${aggregate.trialSeed}`;
    const weight = WEIGHTS.get(aggregate.checkpoint);
    for (const gate of ["bundle", "safe-subset", "bundle-then-subset"]) {
      const map = perGateAuc[gate];
      map.set(seriesKey, (map.get(seriesKey) ?? 0) + gates[gate].safetyConstrainedVac * weight);
    }
    perGateAuc["max-subset"].set(seriesKey,
      (perGateAuc["max-subset"].get(seriesKey) ?? 0) + evaluated.safetyConstrainedVac * weight);
  }

  const clusterMeans = {};
  for (const [gate, map] of Object.entries(perGateAuc)) {
    const byOrganization = {};
    for (const [key, value] of map) {
      const [organizationId] = key.split(":");
      (byOrganization[organizationId] ??= []).push(value);
    }
    const means = Object.values(byOrganization).map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
    clusterMeans[gate] = means.reduce((sum, value) => sum + value, 0) / means.length;
  }

  let evidenceCompleteStratum;
  if (!arm.regimes) {
    const byOrganization = Object.fromEntries(Object.entries(completeLossByOrganization).map(([org, values]) => [org, mean(values)]));
    const byDomainOrgs = {};
    for (const [org, value] of Object.entries(byOrganization)) (byDomainOrgs[org.split("-")[0]] ??= []).push(value);
    evidenceCompleteStratum = {
      acceptedUnits: Object.values(completeLossByOrganization).reduce((sum, values) => sum + values.length, 0),
      bundleMinusSubsetVacOrganizationMean: mean(Object.values(byOrganization)),
      bundleMinusSubsetVacByDomain: Object.fromEntries(Object.entries(byDomainOrgs).map(([domain, values]) => [domain, mean(values)])),
      bundleMinusSubsetVacByOrganization: byOrganization,
    };
  }

  report.arms[arm.key] = {
    units: runSet.runIds.length,
    scVacAucClusterMeans: clusterMeans,
    acceptedUnits,
    maxSubsetKeepsFullBundleOnAccepted: maxEqualsBundleOnAccepted,
    maxSubsetPrunesOnAccepted: maxPrunedOnAccepted,
    maxSubsetPolicyViolations: maxViolations,
    maxSubsetPolicyViolationsOnAcceptedUnits: maxViolationsAccepted,
    rejectedCandidateUnits: rejectedUnits,
    maxSubsetRecoveredOnRejected: maxRecoveredOnRejected,
    btsRecoveredOnRejected,
    maxSubsetSubsetsEvaluated: subsetsEvaluatedTotal,
    ...(evidenceCompleteStratum ? { evidenceCompleteStratum } : {}),
  };
  process.stdout.write(`${arm.key} done\n`);
}

await writeFile(path.join(ROOT, "research", "robustness_max_subset_baseline.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(JSON.stringify(report.arms, null, 1) + "\n");
