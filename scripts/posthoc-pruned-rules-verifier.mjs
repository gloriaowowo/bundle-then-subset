#!/usr/bin/env node
// POST-HOC analysis, added for the camera-ready after the authors' post-acceptance critique
// (CLEA #74: "what do the rules Safe-Subset prunes from an accepted bundle do
// on the verifier itself?"). ZERO MODEL CALLS: stored candidates are replayed
// through the frozen deterministic simulator, grader and release gates on the
// eight development (verifier) cases only.
//
// For every accepted bundle (frozen Bundle gate releases it), the rules that
// Safe-Subset drops are classified by their behaviour when the full bundle runs
// on the verifier cases:
//   firesAndFails     : the rule is the matched rule on >= 1 verifier case and
//                       at least one such case is not an automated pass
//   firesAllPass      : the rule fires only on passing verifier cases
//   matchesButShadowed: the rule never fires but its condition holds on a case
//                       (another rule pre-empts it)
//   verifierUnmatched : the rule's condition holds on no verifier case
//     of which dead   : ... and on no hidden case either (the rule can never
//                       fire on either panel; same definition as
//                       scripts/posthoc-retention-cost.mjs)
// It also counts accepted bundles that fail >= 1 verifier case (acceptance only
// requires >= 1 pass and no policy or grounding failure).
// Self-checks (throw on mismatch): accepted / all-pass counts equal
// research/verifier_work_by_rulecount.json; pruned, verifier-matching,
// verifier-unmatched and dead rule counts equal
// research/retention_cost_accounting.json (both produced by independent replays).
// Requires `npm run build` (dist/). Output: research/pruned_rules_verifier_posthoc.json
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gradeTrace } from "../dist/eval/grader.js";
import { executeWorkflow } from "../dist/simulator/workflow.js";
import { evaluateExpression } from "../dist/simulator/expression.js";

const ROOT = process.cwd();
const OUTPUT = "research/pruned_rules_verifier_posthoc.json";
const readJson = async (f) => JSON.parse(await readFile(path.join(ROOT, f), "utf8"));
const ARMS = [
  { key: "v03_deepseek", experiment: "v03", runSet: "research/robustness_v03_deepseek-deepseek-v4-pro_hidden_run_set.json", regimes: true },
  { key: "v03c_gemini", experiment: "v03c", runSet: "research/robustness_v03c_google-vertex-gemini-3.7-flash_hidden_run_set.json", regimes: true },
  { key: "v05_deepseek", experiment: "v05_stress", runSet: "research/robustness_v05_stress_deepseek-deepseek-v4-pro_hidden_run_set.json", regimes: false },
  { key: "v05b_deepseek", experiment: "v05b_stress", runSet: "research/robustness_v05b_stress_deepseek-deepseek-v4-pro_hidden_run_set.json", regimes: false },
  { key: "v05g_gemini", experiment: "v05g_stress", runSet: "research/robustness_v05g_stress_google-vertex-gemini-3.7-flash_hidden_run_set.json", regimes: false },
  { key: "v05bg_gemini", experiment: "v05bg_stress", runSet: "research/robustness_v05bg_stress_google-vertex-gemini-3.7-flash_hidden_run_set.json", regimes: false },
];
const context = (t) => ({ input: t.input, state: t.initialState, claims: {}, events: [], actorRole: t.actorRole });
const work = await readJson("research/verifier_work_by_rulecount.json");
const retention = await readJson("research/retention_cost_accounting.json");

const report = {
  schemaVersion: 1,
  scientificStatus: "post-hoc-pruned-rule-verifier-behaviour",
  addedFor: "Camera-ready, after the authors' post-acceptance critique (CLEA #74): Safe-Subset's pruned rules on the verifier cases.",
  modelCalls: 0,
  providerCostUsd: 0,
  arms: {},
};
for (const arm of ARMS) {
  const { createOrganizations } = await import(`../experiments/${arm.experiment}/benchmark.mjs`);
  const { applyReleaseGate } = await import(`../experiments/${arm.experiment}/gates.mjs`);
  const runSet = await readJson(arm.runSet); const cache = new Map();
  const c = {
    acceptedBundles: 0, acceptedBundlesAllPass: 0, acceptedBundlesFailingSomeCase: 0,
    unitsWithPrunedRules: 0, unitsWithFiringFailingPrunedRule: 0,
    prunedRules: 0, firesAndFails: 0, firesAllPass: 0, matchesButShadowed: 0, verifierUnmatched: 0, dead: 0,
    verifierFiringsOfPrunedRules: 0, verifierFiringsOfPrunedRulesPassing: 0, failingFiringsByOutcome: {},
  };
  for (const runId of runSet.runIds) {
    const [ag, art] = await Promise.all([readJson(`runs/${runId}/aggregate.json`), readJson(`runs/${runId}/artifacts.json`)]);
    if (!ag.candidateGenerated || !art.candidate) continue;
    const cand = art.candidate;
    const regime = arm.regimes ? ag.evidenceRegime : "gap-0"; const k = `${regime}:${ag.organizationId}`;
    if (!cache.has(k)) cache.set(k, createOrganizations(regime).find((o) => o.id === ag.organizationId));
    const org = cache.get(k); const ids = new Set(org.evidence.slice(0, ag.checkpoint).map((e) => e.id));
    const bundle = applyReleaseGate(cand, "bundle", org.developmentTasks, org.tools, ids).activeWorkflow;
    if (!bundle) continue;
    c.acceptedBundles++;
    const kept = new Set(applyReleaseGate(cand, "safe-subset", org.developmentTasks, org.tools, ids).activeWorkflow.rules.map((r) => r.id));
    const runs = org.developmentTasks.map((t) => { const e = executeWorkflow(bundle, t, org.tools); return { matched: e.matchedRuleId, grade: gradeTrace(t, e.trace, e.finalState, bundle, ids), events: e.trace.events }; });
    if (runs.every((x) => x.grade.automatedPass)) c.acceptedBundlesAllPass++; else c.acceptedBundlesFailingSomeCase++;
    const pruned = bundle.rules.filter((r) => !kept.has(r.id));
    if (pruned.length) c.unitsWithPrunedRules++;
    let unitFlag = false;
    for (const rule of pruned) {
      c.prunedRules++;
      const fired = runs.filter((x) => x.matched === rule.id);
      c.verifierFiringsOfPrunedRules += fired.length;
      c.verifierFiringsOfPrunedRulesPassing += fired.filter((x) => x.grade.automatedPass).length;
      if (fired.length) {
        const failing = fired.filter((x) => !x.grade.automatedPass);
        if (failing.length) {
          c.firesAndFails++; unitFlag = true;
          for (const x of failing) { const kind = x.events.map((e) => e.kind).join("+") || "none"; c.failingFiringsByOutcome[kind] = (c.failingFiringsByOutcome[kind] ?? 0) + 1; }
        } else c.firesAllPass++;
      } else if (org.developmentTasks.some((t) => evaluateExpression(rule.when, context(t)))) c.matchesButShadowed++;
      else { c.verifierUnmatched++; if (!org.hiddenTasks.some((t) => evaluateExpression(rule.when, context(t)))) c.dead++; }
    }
    if (unitFlag) c.unitsWithFiringFailingPrunedRule++;
  }
  // Second paths (independent replays already in the release chain).
  const w = work.arms[arm.key]; const r = retention.arms[arm.key];
  const checks = [
    ["acceptedBundles", w.bundleAccepted], ["acceptedBundlesAllPass", w.acceptedPassingAllVerifierCases],
    ["unitsWithPrunedRules", r.retainedPrunableRules.prunedUnits], ["prunedRules", r.retainedPrunableRules.rules],
    ["firesAndFails+firesAllPass+matchesButShadowed", r.retainedPrunableRules.verifierMatching],
    ["verifierUnmatched", r.retainedPrunableRules.verifierUnmatched], ["dead", r.retainedPrunableRules.deadAmongPruned],
  ];
  for (const [field, expected] of checks) {
    const got = field.split("+").reduce((s, f) => s + c[f], 0);
    if (got !== expected) throw new Error(`${arm.key}: ${field} ${got} != independent ${expected}`);
  }
  report.arms[arm.key] = c;
  process.stderr.write(`${arm.key} done\n`);
}
await writeFile(path.join(ROOT, OUTPUT), `${JSON.stringify(report, null, 2)}\n`, "utf8");
for (const [k, c] of Object.entries(report.arms)) {
  console.log(`${k}: accepted ${c.acceptedBundles} (fail >=1 case ${c.acceptedBundlesFailingSomeCase}); pruned rules ${c.prunedRules}: fires+fails ${c.firesAndFails}, fires all-pass ${c.firesAllPass}, shadowed ${c.matchesButShadowed}, verifier-unmatched ${c.verifierUnmatched} (dead ${c.dead}); firings ${c.verifierFiringsOfPrunedRules} (passing ${c.verifierFiringsOfPrunedRulesPassing})`);
}
