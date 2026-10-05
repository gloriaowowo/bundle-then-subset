#!/usr/bin/env node
// Re-executes every stored hidden-panel gate evaluation of the seven hidden
// runs (v0.2, v0.3 DeepSeek, v0.3c Gemini, and the four v0.5 stress arms) on
// the released retired hidden panels, with zero model calls.
//
//   node artifact_tools/replay-hidden-gates.mjs            # all seven runs (about 1 minute)
//   node artifact_tools/replay-hidden-gates.mjs v02 v05g   # a subset
//
// For each stored unit (runs/<runId>/aggregate.json + artifacts.json, listed
// by the hidden run set in research/) the tool
//   1. checks that the stored candidate hashes to aggregate.candidateHash,
//   2. rebuilds the organization from the frozen constructor
//      (experiments/<arm>/benchmark.mjs, or dist/generator/robustness.js for
//      v0.2) and takes the stored evidence checkpoint,
//   3. applies every release gate to the stored candidate on the development
//      cases and executes the released workflow on every hidden case with the
//      frozen simulator and grader,
//   4. rebuilds each gate-evaluation record exactly as the original run script
//      wrote it and requires it to deep-equal the stored record (every metric,
//      outcome count, per-category rate and active-workflow hash).
// The v0.3-v0.5 arms import their own frozen gates.mjs/outcomes.mjs. The v0.2
// run script (src/robustness-v02.ts) is a provider CLI that exports nothing,
// so its verifier-subset selection and per-gate record are ported verbatim
// below (src/robustness-v02.ts, verifierConfigs, selectVerifierTasks,
// evaluateActiveWorkflow and the gate loop). Results go to
// reproduced/replay-hidden-gates.json; any mismatch fails the command.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readJson, rel } from "./lib.mjs";

const load = (file) => import(pathToFileURL(rel(file)).href);
const roundTrip = (value) => JSON.parse(JSON.stringify(value));

const { gradeTrace } = await load("dist/eval/grader.js");
const { hashArtifact } = await load("dist/eval/manifest.js");
const { safetyConstrainedVac, verifiedAutomationCoverage } = await load("dist/eval/metrics.js");
const { executeWorkflow } = await load("dist/simulator/workflow.js");

const ARMS = {
  v02: { runSet: "research/robustness_v02_hidden_run_set.json", kind: "v02" },
  v03: { runSet: "research/robustness_v03_deepseek-deepseek-v4-pro_hidden_run_set.json", kind: "arm" },
  v03c: { runSet: "research/robustness_v03c_google-vertex-gemini-3.7-flash_hidden_run_set.json", kind: "arm" },
  v05_stress: { runSet: "research/robustness_v05_stress_deepseek-deepseek-v4-pro_hidden_run_set.json", kind: "arm" },
  v05b_stress: { runSet: "research/robustness_v05b_stress_deepseek-deepseek-v4-pro_hidden_run_set.json", kind: "arm" },
  v05g_stress: { runSet: "research/robustness_v05g_stress_google-vertex-gemini-3.7-flash_hidden_run_set.json", kind: "arm" },
  v05bg_stress: { runSet: "research/robustness_v05bg_stress_google-vertex-gemini-3.7-flash_hidden_run_set.json", kind: "arm" },
};
const aliases = { v05: "v05_stress", v05b: "v05b_stress", v05g: "v05g_stress", v05bg: "v05bg_stress" };
const requested = process.argv.slice(2).map((name) => aliases[name] ?? name);
for (const name of requested) assert.ok(ARMS[name], `unknown run ${name}; choose from ${Object.keys(ARMS).join(", ")}`);
const selected = requested.length > 0 ? requested : Object.keys(ARMS);

// --- v0.2: ported from src/robustness-v02.ts --------------------------------
function verifierConfigs(taskCount) {
  const sizes = [1, 2, 4].filter((size) => size < taskCount);
  return [
    { id: `full-${taskCount}`, strategy: "full", size: taskCount },
    ...sizes.flatMap((size) => [
      { id: `uniform-${size}`, strategy: "uniform", size },
      { id: `authorization-critical-${size}`, strategy: "authorization-critical", size },
    ]),
  ];
}

function selectVerifierTasks(tasks, config, trialSeed) {
  if (config.strategy === "full") return [...tasks];
  const tieBreak = (task) => hashArtifact({ taskId: task.id, trialSeed });
  const ordered = [...tasks].sort((left, right) => {
    if (config.strategy === "authorization-critical") {
      const criticality = (task) =>
        task.requiredApprovals.length * 4 +
        task.forbiddenEvents.filter((event) => event.kind === "tool").length * 2 +
        (task.category === "policy_edge" ? 1 : 0);
      const difference = criticality(right) - criticality(left);
      if (difference !== 0) return difference;
    }
    return tieBreak(left).localeCompare(tieBreak(right));
  });
  return ordered.slice(0, config.size);
}

function meanBoolean(grades, key) {
  if (grades.length === 0) return 0;
  return grades.filter((grade) => grade[key] === true).length / grades.length;
}

async function v02Replayer() {
  const { createRobustnessOrganizations } = await load("dist/generator/robustness.js");
  const { fallbackAbstentionWorkflow } = await load("dist/methods/artifacts.js");
  const { applyPromotionGate } = await load("dist/methods/promotion.js");
  const organizations = new Map();
  return (aggregate, candidate) => {
    if (!organizations.has(aggregate.evidenceRegime)) organizations.set(aggregate.evidenceRegime, createRobustnessOrganizations(aggregate.evidenceRegime));
    const organization = organizations.get(aggregate.evidenceRegime).find((item) => item.id === aggregate.organizationId);
    assert.ok(organization, `unknown organization ${aggregate.organizationId}`);
    const visibleEvidence = organization.evidence.slice(0, aggregate.checkpoint);
    const evidenceIds = new Set(visibleEvidence.map((item) => item.id));
    const records = [];
    for (const config of verifierConfigs(organization.developmentTasks.length)) {
      const selectedDevelopmentTasks = selectVerifierTasks(organization.developmentTasks, config, aggregate.trialSeed);
      for (const gate of config.strategy === "full" ? ["direct", "bundle", "safe-subset"] : ["bundle", "safe-subset"]) {
        const promotion = applyPromotionGate(candidate, gate, selectedDevelopmentTasks, organization.tools, evidenceIds);
        const results = organization.hiddenTasks.map((task) => {
          const workflow = promotion.activeWorkflow ?? fallbackAbstentionWorkflow(task, visibleEvidence, `${gate}-${config.id}`);
          const execution = executeWorkflow(workflow, task, organization.tools);
          return { task, grade: gradeTrace(task, execution.trace, execution.finalState, workflow, evidenceIds) };
        });
        const grades = results.map((result) => result.grade);
        const categories = [...new Set(organization.hiddenTasks.map((task) => task.category))];
        const byCategory = Object.fromEntries(categories.map((category) => {
          const subset = results.filter((result) => result.task.category === category).map((result) => result.grade);
          return [category, {
            taskCount: subset.length,
            verifiedAutomationCoverage: verifiedAutomationCoverage(subset),
            functionalPassRate: meanBoolean(subset, "functionalPass"),
            policyPassRate: meanBoolean(subset, "policyPass"),
            groundingPassRate: meanBoolean(subset, "groundingPass"),
          }];
        }));
        const activeWorkflowHash = promotion.activeWorkflow ? hashArtifact(promotion.activeWorkflow) : undefined;
        const { activeWorkflow: _activeWorkflow, ...promotionWithoutWorkflow } = promotion;
        records.push({
          id: `${gate}:${config.id}`,
          gate,
          verifier: config,
          promotion: { ...promotionWithoutWorkflow, ...(activeWorkflowHash ? { activeWorkflowHash } : {}) },
          taskCount: grades.length,
          verifiedAutomationCoverage: verifiedAutomationCoverage(grades),
          safetyConstrainedVac: safetyConstrainedVac(grades),
          functionalPassRate: meanBoolean(grades, "functionalPass"),
          policyPassRate: meanBoolean(grades, "policyPass"),
          groundingPassRate: meanBoolean(grades, "groundingPass"),
          policyFailureCount: grades.filter((grade) => !grade.policyPass).length,
          groundingFailureCount: grades.filter((grade) => !grade.groundingPass).length,
          byCategory,
        });
      }
    }
    return { records, hiddenCases: organization.hiddenTasks.length };
  };
}

// --- v0.3-v0.5 arms: the arm's own frozen modules ---------------------------
// Mirrors the gate loop of experiments/<arm>/run-unit.mjs.
async function armReplayer(arm) {
  const { createOrganizations } = await load(`experiments/${arm}/benchmark.mjs`);
  const { applyReleaseGate, RELEASE_GATES } = await load(`experiments/${arm}/gates.mjs`);
  const { evaluateWorkflowAggregate } = await load(`experiments/${arm}/outcomes.mjs`);
  const organizations = new Map();
  return (aggregate, candidate) => {
    if (!organizations.has(aggregate.evidenceRegime)) organizations.set(aggregate.evidenceRegime, createOrganizations(aggregate.evidenceRegime));
    const organization = organizations.get(aggregate.evidenceRegime).find((item) => item.id === aggregate.organizationId);
    assert.ok(organization, `unknown organization ${aggregate.organizationId}`);
    const visibleEvidence = organization.evidence.slice(0, aggregate.checkpoint);
    const evidenceIds = new Set(visibleEvidence.map((item) => item.id));
    const records = RELEASE_GATES.map((gate) => {
      const decision = applyReleaseGate(candidate, gate, organization.developmentTasks, organization.tools, evidenceIds);
      const evaluated = evaluateWorkflowAggregate({
        candidate,
        activeWorkflow: decision.activeWorkflow,
        tasks: organization.hiddenTasks,
        visibleEvidence,
        tools: organization.tools,
        idSuffix: `${gate}-v03`,
      });
      const activeWorkflowHash = decision.activeWorkflow ? hashArtifact(decision.activeWorkflow) : undefined;
      const { activeWorkflow: _activeWorkflow, ...decisionWithoutWorkflow } = decision;
      return {
        gate,
        verifier: { strategy: "full", size: organization.developmentTasks.length },
        promotion: { ...decisionWithoutWorkflow, ...(activeWorkflowHash ? { activeWorkflowHash } : {}) },
        ...evaluated,
      };
    });
    return { records, hiddenCases: organization.hiddenTasks.length };
  };
}

const report = { schemaVersion: 1, status: "running", modelCalls: 0, runs: [] };
const started = Date.now();
for (const name of selected) {
  const { runSet: runSetFile, kind } = ARMS[name];
  const runSet = await readJson(rel(runSetFile));
  const replay = kind === "v02" ? await v02Replayer() : await armReplayer(name);
  const armStarted = Date.now();
  let units = 0;
  let gateEvaluations = 0;
  let hiddenCaseExecutions = 0;
  const mismatches = [];
  for (const runId of runSet.runIds) {
    const aggregate = await readJson(rel("runs", runId, "aggregate.json"));
    const artifacts = await readJson(rel("runs", runId, "artifacts.json"));
    assert.equal(aggregate.evaluationSplit, "hidden", `${runId}: not a hidden run`);
    assert.equal(aggregate.runStatus, "valid", `${runId}: not a valid run`);
    const candidate = aggregate.candidateGenerated ? artifacts.candidate : undefined;
    if (candidate) assert.equal(hashArtifact(candidate), aggregate.candidateHash, `${runId}: stored candidate does not match candidateHash`);
    else assert.ok(!aggregate.candidateHash, `${runId}: candidateHash without a candidate`);
    const { records, hiddenCases } = replay(aggregate, candidate);
    assert.equal(records.length, aggregate.gateEvaluations.length, `${runId}: gate-evaluation count differs`);
    for (const [index, record] of records.entries()) {
      gateEvaluations += 1;
      hiddenCaseExecutions += hiddenCases;
      try {
        assert.deepStrictEqual(roundTrip(record), aggregate.gateEvaluations[index]);
      } catch {
        mismatches.push({ runId, gateEvaluation: record.id ?? record.gate });
      }
    }
    units += 1;
  }
  const result = {
    run: name,
    runSet: runSetFile,
    units,
    gateEvaluations,
    hiddenCaseExecutions,
    mismatches: mismatches.length,
    firstMismatches: mismatches.slice(0, 5),
    seconds: Math.round((Date.now() - armStarted) / 100) / 10,
  };
  report.runs.push(result);
  process.stdout.write(`${mismatches.length === 0 ? "ok  " : "FAIL"} ${name}: ${units} units, ${gateEvaluations} hidden gate evaluations (${hiddenCaseExecutions} hidden-case executions), ${mismatches.length} mismatches (${result.seconds} s)\n`);
}

const totals = {
  units: report.runs.reduce((sum, run) => sum + run.units, 0),
  gateEvaluations: report.runs.reduce((sum, run) => sum + run.gateEvaluations, 0),
  hiddenCaseExecutions: report.runs.reduce((sum, run) => sum + run.hiddenCaseExecutions, 0),
  mismatches: report.runs.reduce((sum, run) => sum + run.mismatches, 0),
};
report.status = totals.mismatches === 0 ? "passed" : "failed";
report.totals = totals;
report.seconds = Math.round((Date.now() - started) / 1000);
await mkdir(rel("reproduced"), { recursive: true });
await writeFile(rel("reproduced", "replay-hidden-gates.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status: report.status, modelCalls: 0, ...totals, report: path.join("reproduced", "replay-hidden-gates.json") }, null, 2)}\n`);
if (report.status !== "passed") process.exit(1);
