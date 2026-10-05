#!/usr/bin/env node
// POST-HOC analysis, added for the camera-ready in response to reviews (CLEA #74:
// "where does the verifier-work saving come from?"). ZERO MODEL CALLS and no
// replay: reads only the stored, hash-checked run records (runs/*/aggregate.json).
//
// Cost model, per candidate with n rules and bundle acceptance indicator A:
//   Bundle      evaluates 1 artifact;
//   Safe-Subset evaluates 2^n - 1 artifacts (every nonempty subset);
//   BTS         evaluates 1 if accepted, else 1 + (2^n - 1).
// Within a rule-count group with acceptance rate a, the BTS reduction relative
// to Safe-Subset is exactly a - 1/(2^n - 1); the script checks this identity
// and that the stored per-unit subsetsEvaluated agree with the model.
// Also reports released-rule counts, per-unit SC-VAC comparisons of BTS with
// Bundle and Safe-Subset, and the generated rule-count range across arms.
//
// Ported from the camera-ready analysis workspace (bc_verifier_work_rulecount.py).
// Requires `npm run build` (dist/) only for the manifest hash check.
//
// Output: research/verifier_work_by_rulecount.json
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { hashArtifact } from "../dist/eval/manifest.js";

const OUTPUT_PATH = "research/verifier_work_by_rulecount.json";
const EPS = 1e-12;
const ARMS = [
  { key: "v02_deepseek", label: "v0.2 DeepSeek (discovery; BTS reconstructed post hoc)", runSet: "research/robustness_v02_hidden_run_set.json" },
  { key: "v03_deepseek", label: "v0.3 DeepSeek (confirmatory)", runSet: "research/robustness_v03_deepseek-deepseek-v4-pro_hidden_run_set.json" },
  { key: "v03c_gemini", label: "v0.3c Gemini (confirmatory cross-model)", runSet: "research/robustness_v03c_google-vertex-gemini-3.7-flash_hidden_run_set.json" },
  { key: "v05_deepseek", label: "v0.5 DeepSeek approval-blind stress", runSet: "research/robustness_v05_stress_deepseek-deepseek-v4-pro_hidden_run_set.json" },
  { key: "v05b_deepseek", label: "v0.5b DeepSeek escalation-blind stress", runSet: "research/robustness_v05b_stress_deepseek-deepseek-v4-pro_hidden_run_set.json" },
  { key: "v05g_gemini", label: "v0.5g Gemini approval-blind stress", runSet: "research/robustness_v05g_stress_google-vertex-gemini-3.7-flash_hidden_run_set.json" },
  { key: "v05bg_gemini", label: "v0.5bg Gemini escalation-blind stress", runSet: "research/robustness_v05bg_stress_google-vertex-gemini-3.7-flash_hidden_run_set.json" },
];

const ROOT = process.cwd();
const readJson = async (file) => JSON.parse(await readFile(path.join(ROOT, file), "utf8"));
const sum = (values) => values.reduce((s, v) => s + v, 0);
const cls = (delta) => (delta < -EPS ? "lower" : delta > EPS ? "higher" : "equal");
const tally = (deltas) => ({
  lower: deltas.filter((d) => cls(d) === "lower").length,
  equal: deltas.filter((d) => cls(d) === "equal").length,
  higher: deltas.filter((d) => cls(d) === "higher").length,
});
// Full-panel gate record (v0.2 also stores weakened-panel gate records).
const gateRecord = (aggregate, gate) => aggregate.gateEvaluations.find((g) =>
  g.gate === gate && (!g.verifier || g.verifier.strategy === "full"));

const report = {
  schemaVersion: 1,
  scientificStatus: "post-hoc-camera-ready-verifier-work-accounting",
  addedFor: "Camera-ready response to reviews (CLEA #74); not part of any preregistered protocol.",
  modelCalls: 0,
  providerCostUsd: 0,
  costModel: {
    bundle: "1 artifact evaluation per candidate",
    safeSubset: "2^n - 1 artifact evaluations per candidate",
    bts: "1 if the full bundle is accepted, else 1 + (2^n - 1)",
    reductionWithinRuleCount: "a - 1/(2^n - 1), where a is the bundle acceptance rate among n-rule candidates",
    unit: "One artifact evaluation runs the candidate (or subset) on every development case of the panel.",
  },
  arms: {},
};

for (const arm of ARMS) {
  const runSet = await readJson(arm.runSet);
  const units = [];
  for (const runId of runSet.runIds) {
    if (!/^[a-zA-Z0-9._-]+$/.test(runId)) throw new Error(`Unsafe run ID ${runId}.`);
    const [aggregate, manifest] = await Promise.all([
      readJson(`runs/${runId}/aggregate.json`),
      readJson(`runs/${runId}/manifest.json`),
    ]);
    if (manifest.hashes.aggregate !== hashArtifact(aggregate) || aggregate.runStatus !== "valid") {
      throw new Error(`Invalid frozen unit ${runId}.`);
    }
    const n = aggregate.candidateGenerated ? aggregate.candidateRuleCount ?? 0 : 0;
    const bundle = gateRecord(aggregate, "bundle");
    const subset = gateRecord(aggregate, "safe-subset");
    const direct = gateRecord(aggregate, "direct");
    const bts = gateRecord(aggregate, "bundle-then-subset");
    const unit = { runId, checkpoint: aggregate.checkpoint, n, candidate: n > 0 };
    if (unit.candidate) {
      unit.accepted = bundle.promotion.promotedRuleCount > 0;
      unit.bundleDevelopmentPasses = bundle.promotion.developmentAutomatedPasses;
      unit.safeSubsetEvals = subset.promotion.subsetsEvaluated;
      unit.bundleEvals = bundle.promotion.subsetsEvaluated;
      unit.btsEvals = unit.accepted ? 1 : 1 + unit.safeSubsetEvals;
      if (unit.safeSubsetEvals !== 2 ** n - 1) throw new Error(`Safe-Subset evaluations != 2^n-1 in ${runId}.`);
      if (unit.bundleEvals !== 1) throw new Error(`Bundle evaluations != 1 in ${runId}.`);
      if (bts && bts.promotion.subsetsEvaluated !== unit.btsEvals) throw new Error(`Stored BTS evaluations disagree in ${runId}.`);
      unit.releasedRules = {
        direct: direct.promotion.promotedRuleCount,
        bundle: bundle.promotion.promotedRuleCount,
        safeSubset: subset.promotion.promotedRuleCount,
        bts: unit.accepted ? bundle.promotion.promotedRuleCount : subset.promotion.promotedRuleCount,
      };
      if (bts && bts.promotion.promotedRuleCount !== unit.releasedRules.bts) {
        throw new Error(`Stored BTS released-rule count disagrees in ${runId}.`);
      }
    }
    if (bts) {
      unit.scBts = bts.safetyConstrainedVac;
      unit.scBundle = bundle.safetyConstrainedVac;
      unit.scSafeSubset = subset.safetyConstrainedVac;
    }
    units.push(unit);
  }

  const candidates = units.filter((u) => u.candidate);
  const accepted = candidates.filter((u) => u.accepted);
  const rejected = candidates.filter((u) => !u.accepted);
  const ruleCounts = [...new Set(candidates.map((u) => u.n))].sort((a, b) => a - b);
  const byRuleCount = ruleCounts.map((n) => {
    const group = candidates.filter((u) => u.n === n);
    const acc = group.filter((u) => u.accepted).length;
    const ss = sum(group.map((u) => u.safeSubsetEvals));
    const bts = sum(group.map((u) => u.btsEvals));
    const a = acc / group.length;
    const reduction = 1 - bts / ss;
    const closedForm = a - 1 / (2 ** n - 1);
    if (Math.abs(reduction - closedForm) > 1e-12) throw new Error(`Closed form fails for n=${n} in ${arm.key}.`);
    return { rules: n, candidates: group.length, bundleAccepted: acc, acceptRate: a, safeSubsetEvals: ss, btsEvals: bts, bundleEvals: group.length, reduction, closedFormReduction: closedForm };
  });
  const checkpoints = [...new Set(candidates.map((u) => u.checkpoint))].sort((a, b) => a - b);
  const byCheckpoint = checkpoints.map((c) => {
    const group = candidates.filter((u) => u.checkpoint === c);
    return {
      checkpoint: c,
      candidates: group.length,
      bundleAccepted: group.filter((u) => u.accepted).length,
      safeSubsetEvals: sum(group.map((u) => u.safeSubsetEvals)),
      btsEvals: sum(group.map((u) => u.btsEvals)),
    };
  });
  const ssTotal = sum(candidates.map((u) => u.safeSubsetEvals));
  const btsTotal = sum(candidates.map((u) => u.btsEvals));
  const released = (key, set) => sum(set.map((u) => u.releasedRules[key]));
  const prunedAccepted = accepted.filter((u) => u.releasedRules.safeSubset < u.n);

  const armReport = {
    label: arm.label,
    units: units.length,
    candidateUnits: candidates.length,
    bundleAccepted: accepted.length,
    acceptRate: accepted.length / candidates.length,
    // Accepted bundles that pass every verifier case: a pass-maximizing search that
    // ties toward more rules (Max-Subset) could stop after this one evaluation, since
    // no subset can pass more cases or contain more rules. Exhaustive implementations
    // (as run here) enumerate all 2^n-1 subsets regardless.
    acceptedPassingAllVerifierCases: accepted.filter((u) => u.bundleDevelopmentPasses === 8).length,
    ruleCountDistribution: Object.fromEntries(ruleCounts.map((n) => [n, candidates.filter((u) => u.n === n).length])),
    ruleCountRange: [ruleCounts[0], ruleCounts.at(-1)],
    verifierArtifactEvals: {
      bundle: candidates.length,
      safeSubset: ssTotal,
      bts: btsTotal,
      btsReduction: 1 - btsTotal / ssTotal,
      btsIfFullSetNotRetestedOnRejection: btsTotal - rejected.length,
      btsReductionIfFullSetNotRetested: 1 - (btsTotal - rejected.length) / ssTotal,
    },
    byRuleCount,
    byCheckpoint,
    releasedRules: {
      allUnits: {
        direct: released("direct", candidates),
        bundle: released("bundle", candidates),
        safeSubset: released("safeSubset", candidates),
        bts: released("bts", candidates),
      },
      acceptedUnits: {
        units: accepted.length,
        bundleAndBts: released("bundle", accepted),
        safeSubset: released("safeSubset", accepted),
        extraRulesKeptByBundleAndBts: released("bundle", accepted) - released("safeSubset", accepted),
        relativeIncrease: released("bundle", accepted) / released("safeSubset", accepted) - 1,
        safeSubsetPrunedUnits: prunedAccepted.length,
      },
      rejectedUnits: {
        units: rejected.length,
        recoveredBySubset: rejected.filter((u) => u.releasedRules.safeSubset > 0).length,
      },
    },
  };

  // Per-unit SC-VAC comparisons (arms that stored a BTS gate record).
  if (units.every((u) => u.scBts !== undefined)) {
    const acceptedSet = new Set(accepted.map((u) => u.runId));
    const recovery = units.filter((u) => u.candidate && !u.accepted && u.releasedRules.bts > 0);
    const recoverySet = new Set(recovery.map((u) => u.runId));
    const noRelease = units.filter((u) => !acceptedSet.has(u.runId) && !recoverySet.has(u.runId));
    const vsBundle = (set) => tally(set.map((u) => u.scBts - u.scBundle));
    armReport.unitLevelScVac = {
      btsMinusBundle: {
        allUnits: vsBundle(units),
        acceptedUnits: vsBundle(units.filter((u) => acceptedSet.has(u.runId))),
        recoveryUnits: vsBundle(recovery),
        noReleaseUnits: vsBundle(noRelease),
        noReleaseUnitCount: noRelease.length,
      },
      btsMinusSafeSubset: { allUnits: tally(units.map((u) => u.scBts - u.scSafeSubset)) },
    };
  }
  report.arms[arm.key] = armReport;
}

const allRuleCounts = Object.values(report.arms).flatMap((a) => a.ruleCountRange);
report.generatedRuleCountRangeAcrossArms = [Math.min(...allRuleCounts), Math.max(...allRuleCounts)];

await writeFile(path.join(ROOT, OUTPUT_PATH), `${JSON.stringify(report, null, 2)}\n`, "utf8");
for (const [key, a] of Object.entries(report.arms)) {
  const v = a.verifierArtifactEvals;
  process.stdout.write(`${key}: candidates ${a.candidateUnits}, accepted ${a.bundleAccepted}, rules ${a.ruleCountRange.join("-")}, ` +
    `Safe-Subset ${v.safeSubset} vs BTS ${v.bts} (${(100 * v.btsReduction).toFixed(1)}% fewer)\n`);
  for (const r of a.byRuleCount) {
    process.stdout.write(`   n=${r.rules}: ${r.candidates} cand, a=${r.acceptRate.toFixed(3)}, ${r.safeSubsetEvals} vs ${r.btsEvals} (${(100 * r.reduction).toFixed(1)}%)\n`);
  }
  if (a.unitLevelScVac) process.stdout.write(`   unit SC-VAC BTS-Bundle ${JSON.stringify(a.unitLevelScVac.btsMinusBundle)}; BTS-SS ${JSON.stringify(a.unitLevelScVac.btsMinusSafeSubset)}\n`);
}
process.stdout.write(`rule-count range across arms: ${report.generatedRuleCountRangeAcrossArms.join("-")}\n`);
