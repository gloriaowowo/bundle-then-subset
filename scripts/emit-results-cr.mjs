#!/usr/bin/env node
// Camera-ready macro and table emitter (CLEA #74). Reads ONLY the post-hoc
// research JSONs written by the zero-model-call scripts below and emits LaTeX:
//   paper/latex/results_cr.tex          \CR... number macros
//   paper/latex/cr_table_masks.tex      per-mask win/tie/loss table
//   paper/latex/cr_table_verifier_work.tex
//   paper/latex/cr_table_retention.tex
// Inputs (regenerate in this order; each is zero model calls):
//   node scripts/analyze-max-subset.mjs            -> research/robustness_max_subset_baseline.json
//   node scripts/posthoc-v04-mask-distribution.mjs -> research/robustness_v04_mask_distribution.json
//   node scripts/posthoc-verifier-work.mjs         -> research/verifier_work_by_rulecount.json
//   node scripts/posthoc-retention-cost.mjs        -> research/retention_cost_accounting.json
//   node scripts/posthoc-full-verifier-separation.mjs -> research/full_verifier_separation.json
//   node scripts/posthoc-recovery-variants.mjs     -> research/recovery_variants_posthoc.json
//   node scripts/analyze-cross-model-concordance.mjs -> research/robustness_cross_model_concordance.json
//   node scripts/posthoc-stress-pairing.mjs        -> research/stress_arm_cache_pairing.json
// Added after the authors' post-acceptance critique (post-hoc, zero model calls):
//   node scripts/posthoc-early-exit-eval-counts.mjs -> research/early_exit_eval_counts.json
//   node scripts/posthoc-max-subset-masks.mjs      -> research/max_subset_masks_posthoc.json
//   node scripts/posthoc-pruned-rules-verifier.mjs -> research/pruned_rules_verifier_posthoc.json
//   node scripts/posthoc-v02-pruning-by-domain.mjs -> research/v02_pruning_by_domain.json
//   node scripts/posthoc-h3-by-org.mjs             -> research/h3_by_organization_posthoc.json
//   node scripts/emit-results-cr.mjs
// The tables use only \CR macros, so main.tex must \input{results_cr.tex}
// before \input-ing any cr_table_*.tex.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const masks = readJson("research/robustness_v04_mask_distribution.json");
const work = readJson("research/verifier_work_by_rulecount.json");
const retention = readJson("research/retention_cost_accounting.json");
const separation = readJson("research/full_verifier_separation.json");
const recovery = readJson("research/recovery_variants_posthoc.json");
const maxSubset = readJson("research/robustness_max_subset_baseline.json");
const concordance = readJson("research/robustness_cross_model_concordance.json");
const pairing = readJson("research/stress_arm_cache_pairing.json");
const earlyExit = readJson("research/early_exit_eval_counts.json");
const maxMasks = readJson("research/max_subset_masks_posthoc.json");
const prunedRules = readJson("research/pruned_rules_verifier_posthoc.json");
const v02Domain = readJson("research/v02_pruning_by_domain.json");
const h3Org = readJson("research/h3_by_organization_posthoc.json");
for (const doc of [masks, work, retention, separation, recovery, maxSubset, concordance, pairing, earlyExit, maxMasks, prunedRules, v02Domain, h3Org]) {
  if (doc.modelCalls !== 0) throw new Error("Every camera-ready input must be a zero-model-call analysis.");
}

const WORDS = { 1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight", 16: "Sixteen", 24: "TwentyFour", 32: "ThirtyTwo" };
const ARM = {
  v02_deepseek: "DSDisc",
  v03_deepseek: "DSConf",
  v03c_gemini: "GemConf",
  v05_deepseek: "DSApprBlind",
  v05b_deepseek: "DSEscBlind",
  v05g_gemini: "GemApprBlind",
  v05bg_gemini: "GemEscBlind",
};
const camel = (s) => s.split(/[_-]/).map((w) => w[0].toUpperCase() + w.slice(1)).join("");

const minus = (s) => s.replace(/^-/, "$-$");
const int = (n) => {
  if (!Number.isInteger(n)) throw new Error(`Expected integer, got ${n}`);
  return minus(n.toLocaleString("en-US"));
};
const fix = (x, d = 3) => minus(x.toFixed(d) === (-0).toFixed(d) ? (0).toFixed(d) : x.toFixed(d));
const signed = (x, d = 3) => (x > 0 && Number(x.toFixed(d)) !== 0 ? `+${x.toFixed(d)}` : fix(x, d));
const pct = (x, d = 1) => `${minus((100 * x).toFixed(d))}\\%`;
const signedPct = (x, d = 1) => (x > 0 ? `+${(100 * x).toFixed(d)}\\%` : pct(x, d));

const macros = [];
const seen = new Set();
const def = (name, value) => {
  if (!/^CR[A-Za-z]+$/.test(name)) throw new Error(`Illegal macro name ${name}`);
  if (seen.has(name)) throw new Error(`Duplicate macro ${name}`);
  seen.add(name);
  macros.push([name, String(value)]);
};
const section = (title) => macros.push([null, title]);

// ---------------------------------------------------------------- masks
section("Per-mask verifier replay, v0.3 DeepSeek (research/robustness_v04_mask_distribution.json)");
const ss = masks.btsVersusSafeSubset;
def("CRMaskTotal", int(masks.counts.masks));
def("CRMaskWeakened", int(masks.counts.weakenedMasks));
def("CRMaskSemanticTotal", int(masks.counts.semanticMasks));
def("CRMaskSeriesPerMask", int(masks.counts.seedSeriesPerMask));
const groupMacros = (prefix, g) => {
  def(`${prefix}Masks`, int(g.masks));
  def(`${prefix}ViolLower`, int(g.violation.lower));
  def(`${prefix}ViolEqual`, int(g.violation.equal));
  def(`${prefix}ViolHigher`, int(g.violation.higher));
  def(`${prefix}ScLower`, int(g.safetyConstrainedVac.lower));
  def(`${prefix}ScEqual`, int(g.safetyConstrainedVac.equal));
  def(`${prefix}ScHigher`, int(g.safetyConstrainedVac.higher));
  def(`${prefix}DeltaViol`, signed(g.meanDeltaViolationAuc, 4));
  def(`${prefix}DeltaSc`, signed(g.meanDeltaScAuc, 3));
};
ss.bySemanticStratumCount.forEach((g, i) => groupMacros(`CRMaskStrata${WORDS[i + 1]}`, g));
groupMacros("CRMaskSemantic", ss.allSemanticMasks);
groupMacros("CRMaskAll", ss.allMasks);
groupMacros("CRMaskWeakenedSet", ss.weakenedMasks);
groupMacros("CRMaskDEightAbsent", ss.escalationCaseD8Absent);
groupMacros("CRMaskDEightPresent", ss.escalationCaseD8Present);
groupMacros("CRMaskDEightNoDThree", ss.d8PresentD3Absent);
groupMacros("CRMaskDEightDThree", ss.d8PresentD3Present);
ss.byVerifierSize.forEach((g, i) => {
  const p = `CRMaskSize${WORDS[i + 1]}`;
  def(`${p}Masks`, int(g.masks));
  def(`${p}ViolLower`, int(g.violation.lower));
  def(`${p}ViolEqual`, int(g.violation.equal));
  def(`${p}ViolHigher`, int(g.violation.higher));
  def(`${p}DeltaSc`, signed(g.meanDeltaScAuc, 3));
});
const all = ss.allMasks;
def("CRMaskSeriesTotal", int(masks.counts.seedSeriesTotal));
def("CRMaskSeriesScLower", int(all.seedSeriesSc.lower));
def("CRMaskSeriesScEqual", int(all.seedSeriesSc.equal));
def("CRMaskSeriesScHigher", int(all.seedSeriesSc.higher));
def("CRMaskCellTotal", int(masks.counts.unitCheckpointsTotal));
def("CRMaskCellScLower", int(all.unitCheckpointSc.lower));
def("CRMaskOrgPairTotal", int(masks.counts.organizationMaskPairs));
def("CRMaskOrgPairScLower", int(all.organizationMaskSc.lower));
def("CRMaskOrgPairScEqual", int(all.organizationMaskSc.equal));
def("CRMaskOrgPairScHigher", int(all.organizationMaskSc.higher));
const hi = masks.btsHigherViolationThanSafeSubset;
def("CRMaskHigherTotal", int(hi.total));
def("CRMaskHigherDEightNoDThree", int(hi.d8PresentD3Absent));
def("CRMaskHigherDEightDThree", int(hi.d8PresentD3Present));
def("CRMaskHigherNoDEight", int(hi.d8Absent));
masks.depthSweep.forEach((d) => {
  const w = WORDS[d.droppedStrata];
  def(`CRMaskDepth${w}Masks`, int(d.masks));
  def(`CRMaskDepth${w}SubsetSc`, fix(d.safeSubsetScAuc));
  def(`CRMaskDepth${w}BtsSc`, fix(d.btsScAuc));
  def(`CRMaskDepth${w}BundleSc`, fix(d.bundleScAuc));
  def(`CRMaskDepth${w}Ratio`, d.safeSubsetOverBtsViolationRatio.toFixed(2));
});
const vb = masks.btsVersusBundle.allMasks;
def("CRMaskBundleViolLower", int(vb.violation.lower));
def("CRMaskBundleViolEqual", int(vb.violation.equal));
def("CRMaskBundleViolHigher", int(vb.violation.higher));
def("CRMaskBundleScLower", int(vb.safetyConstrainedVac.lower));
def("CRMaskBundleScEqual", int(vb.safetyConstrainedVac.equal));
def("CRMaskBundleScHigher", int(vb.safetyConstrainedVac.higher));

// ---------------------------------------------------------------- verifier work
section("Verifier work by rule count (research/verifier_work_by_rulecount.json)");
def("CRRuleCountMin", int(work.generatedRuleCountRangeAcrossArms[0]));
def("CRRuleCountMax", int(work.generatedRuleCountRangeAcrossArms[1]));
def("CRRuleCountRangeWords", `${WORDS[work.generatedRuleCountRangeAcrossArms[0]].toLowerCase()} to ${WORDS[work.generatedRuleCountRangeAcrossArms[1]].toLowerCase()}`);
for (const [key, a] of Object.entries(work.arms)) {
  const p = `CRWork${ARM[key]}`;
  const v = a.verifierArtifactEvals;
  def(`${p}Candidates`, int(a.candidateUnits));
  def(`${p}Accepted`, int(a.bundleAccepted));
  def(`${p}AcceptedAllPass`, int(a.acceptedPassingAllVerifierCases));
  def(`${p}AcceptRate`, pct(a.acceptRate));
  def(`${p}SubsetEvals`, int(v.safeSubset));
  def(`${p}BtsEvals`, int(v.bts));
  def(`${p}Reduction`, pct(v.btsReduction));
  def(`${p}BtsNoRetest`, int(v.btsIfFullSetNotRetestedOnRejection));
  def(`${p}ReductionNoRetest`, pct(v.btsReductionIfFullSetNotRetested));
  def(`${p}RuleMin`, int(a.ruleCountRange[0]));
  def(`${p}RuleMax`, int(a.ruleCountRange[1]));
  const confirmatory = key === "v03_deepseek" || key === "v03c_gemini";
  for (const r of confirmatory ? a.byRuleCount : []) {
    const q = `${p}N${WORDS[r.rules]}`;
    def(`${q}Candidates`, int(r.candidates));
    def(`${q}AcceptRate`, pct(r.acceptRate));
    def(`${q}SubsetEvals`, int(r.safeSubsetEvals));
    def(`${q}BtsEvals`, int(r.btsEvals));
    def(`${q}Reduction`, pct(r.reduction));
  }
  if (confirmatory) {
    for (const c of a.byCheckpoint) {
      def(`${p}Cp${WORDS[c.checkpoint]}SubsetEvals`, int(c.safeSubsetEvals));
      def(`${p}Cp${WORDS[c.checkpoint]}BtsEvals`, int(c.btsEvals));
    }
  }
  const ar = a.releasedRules.acceptedUnits;
  def(`${p}AcceptedRulesBundle`, int(ar.bundleAndBts));
  def(`${p}AcceptedRulesSubset`, int(ar.safeSubset));
  if (a.unitLevelScVac) {
    const u = a.unitLevelScVac;
    const q = `CRUnit${ARM[key]}`;
    def(`${q}Units`, int(a.units));
    def(`${q}AcceptedEqual`, int(u.btsMinusBundle.acceptedUnits.equal));
    def(`${q}AcceptedNotEqual`, int(u.btsMinusBundle.acceptedUnits.lower + u.btsMinusBundle.acceptedUnits.higher));
    def(`${q}RecoveryUnits`, int(u.btsMinusBundle.recoveryUnits.lower + u.btsMinusBundle.recoveryUnits.equal + u.btsMinusBundle.recoveryUnits.higher));
    def(`${q}RecoveryHigher`, int(u.btsMinusBundle.recoveryUnits.higher));
    def(`${q}NoReleaseUnits`, int(u.btsMinusBundle.noReleaseUnitCount));
    def(`${q}BundleLower`, int(u.btsMinusBundle.allUnits.lower));
    def(`${q}SubsetEqual`, int(u.btsMinusSafeSubset.allUnits.equal));
    def(`${q}SubsetLower`, int(u.btsMinusSafeSubset.allUnits.lower));
  }
}

// ---------------------------------------------------------------- retention
section("Retained-rule cost accounting (research/retention_cost_accounting.json)");
for (const [key, a] of Object.entries(retention.arms)) {
  const p = `CRRetain${ARM[key]}`;
  const m = a.acceptedUnitsMatched;
  const r = a.retainedPrunableRules;
  const u = a.verifierUnmatchedAndDeadRules;
  def(`${p}AcceptedUnits`, int(a.acceptedUnits));
  def(`${p}RulesBundle`, int(m.bundle.releasedRules));
  def(`${p}RulesSubset`, int(m["safe-subset"].releasedRules));
  def(`${p}ExtraRules`, int(m.extraRules));
  def(`${p}ExtraRulesPct`, signedPct(m.extraRulesRelative));
  def(`${p}PrunedUnits`, int(r.prunedUnits));
  def(`${p}HiddenTasks`, int(m.bundle.hiddenTasks));
  def(`${p}CondBundle`, fix(m.bundle.conditionEvalsPerTaskUnitWeighted));
  def(`${p}CondSubset`, fix(m["safe-subset"].conditionEvalsPerTaskUnitWeighted));
  def(`${p}CondPct`, signedPct(m.conditionEvalsRelativeUnitWeighted));
  def(`${p}CondBundleTaskW`, fix(m.bundle.conditionEvalsPerTaskTaskWeighted));
  def(`${p}CondSubsetTaskW`, fix(m["safe-subset"].conditionEvalsPerTaskTaskWeighted));
  def(`${p}CondPctTaskW`, signedPct(m.conditionEvalsRelativeTaskWeighted));
  def(`${p}ToolsBundle`, fix(m.bundle.toolCallsPerTaskUnitWeighted));
  def(`${p}ToolsSubset`, fix(m["safe-subset"].toolCallsPerTaskUnitWeighted));
  def(`${p}MultiBundle`, pct(m.bundle.multiMatchShare));
  def(`${p}MultiSubset`, pct(m["safe-subset"].multiMatchShare));
  def(`${p}Preempt`, int(a.preemption.bothFireDifferentRule));
  def(`${p}Firings`, int(r.hiddenFirings));
  def(`${p}FiringPasses`, int(r.firingsAutomatedPass));
  def(`${p}FiringPolicyFail`, int(r.firingsPolicyFailure));
  def(`${p}FiringPolicySafeNonPass`, int(r.firingsPolicySafeNonPass + r.firingsGroundingFailure + r.firingsOtherNonPass));
  def(`${p}PrunedVerifierMatching`, int(r.verifierMatching));
  def(`${p}PrunedVerifierUnmatched`, int(r.verifierUnmatched));
  def(`${p}ScChangedUnits`, int(r.prunedUnitsWithScChange));
  def(`${p}VacChangedUnits`, int(r.prunedUnitsWithVacChange));
  def(`${p}UnmatchedRules`, int(u.verifierUnmatchedRules));
  def(`${p}UnmatchedRuleUnits`, int(u.acceptedUnitsWithVerifierUnmatchedRule));
  def(`${p}DeadRules`, int(u.deadRules));
  for (const [cls, v] of Object.entries(r.outcomeClassBundleMinusSafeSubset)) def(`${p}Outcome${camel(cls)}`, int(v));
}
const ds = retention.arms.v03_deepseek;
if (ds.verifierUnmatchedAndDeadRules.deadRules !== ds.verifierUnmatchedAndDeadRules.acceptedUnitsWithVerifierUnmatchedRule) {
  process.stderr.write("note: some DeepSeek v0.3 accepted bundles contain more than one dead rule\n");
}

// ---------------------------------------------------------------- separation
section("Full-verifier separation (research/full_verifier_separation.json)");
for (const [key, c] of Object.entries(separation.arms)) {
  const p = `CRSep${ARM[key]}`;
  def(`${p}Candidates`, int(c.candidates));
  def(`${p}TrueAccepts`, int(c.trueAccepts));
  def(`${p}TrueRejects`, int(c.trueRejects));
  def(`${p}FalseAccepts`, int(c.falseAccepts));
  def(`${p}FalseRejects`, int(c.falseRejects));
}

// ---------------------------------------------------------------- recovery variants
section("Exploratory recovery variants, full verifier only (research/recovery_variants_posthoc.json)");
for (const [key, variants] of Object.entries(recovery.arms)) {
  for (const [variant, v] of Object.entries(variants)) {
    const p = `CRRecov${ARM[key]}${camel(variant.replace(/^bts-/, ""))}`;
    def(`${p}Evals`, int(v.verifierArtifactEvals));
    def(`${p}Sc`, fix(v.scAucClusterMean));
    def(`${p}Recovered`, int(v.recoveredRejected));
    def(`${p}MeanRules`, v.meanRecoveredRules === null ? "---" : v.meanRecoveredRules.toFixed(2));
    def(`${p}PolicyFailures`, int(v.hiddenPolicyFailures));
  }
  const ex = variants["bts-exhaustive"].verifierArtifactEvals;
  def(`CRRecov${ARM[key]}GreedyEvalShare`, pct(variants["bts-greedy"].verifierArtifactEvals / ex, 0));
  def(`CRRecov${ARM[key]}DescendEvalShare`, pct(variants["bts-descend"].verifierArtifactEvals / ex, 0));
}

// ---------------------------------------------------------------- Max-Subset (fixed series key)
section("Max-Subset tie-break control (research/robustness_max_subset_baseline.json)");
for (const [key, a] of Object.entries(maxSubset.arms)) {
  const p = `CRMax${ARM[key]}`;
  const c = a.scVacAucClusterMeans;
  def(`${p}BundleSc`, fix(c.bundle));
  def(`${p}SubsetSc`, fix(c["safe-subset"]));
  def(`${p}BtsSc`, fix(c["bundle-then-subset"]));
  def(`${p}MaxSc`, fix(c["max-subset"]));
  def(`${p}Evals`, int(a.maxSubsetSubsetsEvaluated));
  def(`${p}Violations`, int(a.maxSubsetPolicyViolations));
  // Stress arms: evidence-complete Bundle minus Safe-Subset hidden coverage (design constant).
  const e = a.evidenceCompleteStratum;
  if (e) {
    def(`${p}CompleteUnits`, int(e.acceptedUnits));
    def(`${p}CompleteLoss`, fix(e.bundleMinusSubsetVacOrganizationMean, 2));
    def(`${p}CompleteLossExpense`, fix(e.bundleMinusSubsetVacByDomain.expense, 2));
    def(`${p}CompleteLossAccess`, fix(e.bundleMinusSubsetVacByDomain.access, 2));
  }
}
{
  const arms = Object.values(maxSubset.arms);
  if (arms.some((a) => a.maxSubsetPrunesOnAccepted !== 0)) throw new Error("Max-Subset pruned an accepted bundle; revise the paper text.");
  def("CRMaxAllAccepted", int(arms.reduce((sum, a) => sum + a.acceptedUnits, 0)));
  def("CRMaxAllKeepsBundle", int(arms.reduce((sum, a) => sum + a.maxSubsetKeepsFullBundleOnAccepted, 0)));
}

// ---------------------------------------------------------------- cross-model concordance
section("Cross-model accept/reject concordance, v0.3 vs v0.3c (research/robustness_cross_model_concordance.json)");
def("CRConcordUnits", int(concordance.sharedUnitKeys));
def("CRConcordMatched", int(concordance.bothCandidatesGenerated));
def("CRConcordMatchedAgree", int(concordance.bothCandidatesGeneratedConcordant));
def("CRConcordThreeWay", int(concordance.threeWayOutcomeConcordant));
def("CRConcordCheckpointZero", int(concordance.checkpointZeroUnits));

// ---------------------------------------------------------------- stress-arm cache pairing
section("Stress-arm cache pairing (research/stress_arm_cache_pairing.json)");
for (const [model, code] of [["deepseek", "DS"], ["gemini", "Gem"]]) {
  const m = pairing.models[model];
  def(`CRPair${code}Candidates`, int(m.candidatesPaired));
  def(`CRPair${code}CandidatesTotal`, int(m.nonzeroCheckpointCandidates));
  def(`CRPair${code}Units`, int(m.unitsPaired));
  def(`CRPair${code}UnitsTotal`, int(m.units));
  def(`CRPair${code}UnpairedUnits`, int(m.unpairedUnits.length));
  def(`CRPair${code}UnpairedCost`, fix(m.escalationBlindUnpairedUnitsCostUsd, 3));
  def(`CRPair${code}EscBlindCost`, fix(m.escalationBlindHiddenBillableCostUsd, 3));
}

// ================================================================ post-acceptance additions
// POST-HOC, added for the camera-ready after the authors' post-acceptance critique; every input
// below is a zero-model-call replay or re-aggregation of stored runs.
// Cross-source consistency checks: numbers that two independent scripts both
// produce must agree, or the emitter refuses to write.
const agree = (label, a, b) => { if (a !== b) throw new Error(`Inconsistent ${label}: ${a} vs ${b}`); };

// ---------------------------------------------------------------- early-exit evaluation counts
section("Post-critique: verifier evaluations vs early-exit Max-Subset and recovery variants (research/early_exit_eval_counts.json)");
for (const [key, a] of Object.entries(earlyExit.arms)) {
  const p = `CREarly${ARM[key]}`;
  agree(`${key} Safe-Subset evals`, a.safeSubset, work.arms[key].verifierArtifactEvals.safeSubset);
  agree(`${key} BTS evals`, a.bts, work.arms[key].verifierArtifactEvals.bts);
  agree(`${key} descend evals`, a.btsDescend, recovery.arms[key]["bts-descend"].verifierArtifactEvals);
  agree(`${key} greedy evals`, a.btsGreedy, recovery.arms[key]["bts-greedy"].verifierArtifactEvals);
  def(`${p}Candidates`, int(a.candidates));
  def(`${p}BundleAllPass`, int(a.bundleSafeAllPass));
  def(`${p}SubsetEvals`, int(a.safeSubset));
  def(`${p}BtsEvals`, int(a.bts));
  def(`${p}MaxPlainEvals`, int(a.maxSubsetPlain));
  def(`${p}MaxEarlyEvals`, int(a.maxSubsetEarlyExit));
  def(`${p}DescendEvals`, int(a.btsDescend));
  def(`${p}GreedyEvals`, int(a.btsGreedy));
  def(`${p}SavingVsSubset`, pct(a.btsSavingVsSafeSubset));
  def(`${p}SavingVsMaxEarly`, pct(a.btsSavingVsMaxSubsetEarlyExit));
  def(`${p}ExtraVsDescend`, pct(a.btsExtraVsDescend));
  def(`${p}ExtraVsGreedy`, pct(a.btsExtraVsGreedy));
}

// ---------------------------------------------------------------- Max-Subset under verifier masks
section("Post-critique: Max-Subset and BTS with Max-Subset recovery under the 255 verifier masks, v0.3 DeepSeek (research/max_subset_masks_posthoc.json)");
{
  const cmp = maxMasks.comparisons;
  agree("mask count", maxMasks.masks, masks.counts.masks);
  agree("BTS-vs-Safe-Subset violation higher", cmp.btsMinusSafeSubset.allMasks.violAuc.higher, masks.btsVersusSafeSubset.allMasks.violation.higher);
  agree("BTS-vs-Bundle violation higher", cmp.btsMinusBundle.allMasks.violAuc.higher, masks.btsVersusBundle.allMasks.violation.higher);
  def("CRMaxMaskTotal", int(maxMasks.masks));
  def("CRMaxMaskWeakened", int(maxMasks.weakenedMasks));
  for (const [name, c] of [["VsBts", cmp.maxSubsetMinusBts], ["VsSubset", cmp.maxSubsetMinusSafeSubset]]) {
    const q = `CRMaxMask${name}`;
    def(`${q}ScHigher`, int(c.allMasks.scAuc.higher));
    def(`${q}ScEqual`, int(c.allMasks.scAuc.equal));
    def(`${q}ScLower`, int(c.allMasks.scAuc.lower));
    def(`${q}ViolLower`, int(c.allMasks.violAuc.lower));
    def(`${q}ViolEqual`, int(c.allMasks.violAuc.equal));
    def(`${q}ViolHigher`, int(c.allMasks.violAuc.higher));
  }
  def("CRMaxMaskVsBtsMaxScDeficit", fix(-Math.min(0, cmp.maxSubsetMinusBts.minScAucDifference), 4));
  const w = maxMasks.meansOverWeakenedMasks;
  for (const [g, code] of [["bundle", "Bundle"], ["safe-subset", "Subset"], ["bts", "Bts"], ["max-subset", "Max"]]) {
    def(`CRMaxMaskWeak${code}Sc`, fix(w[g].scAuc));
    def(`CRMaxMaskWeak${code}Viol`, fix(w[g].violAuc, 4));
  }
  def("CRMaxMaskMaxrecIdentical", int(maxMasks.btsMaxrecEqualsMaxSubset.masksWithIdenticalMeans));
}

// ---------------------------------------------------------------- pruned rules on the verifier
section("Post-critique: what Safe-Subset's pruned rules do on the verifier cases (research/pruned_rules_verifier_posthoc.json)");
for (const key of ["v03_deepseek", "v03c_gemini"]) {
  const c = prunedRules.arms[key]; const p = `CRPruned${ARM[key]}`;
  agree(`${key} pruned rules (verifier-matching)`, c.firesAndFails + c.firesAllPass + c.matchesButShadowed, retention.arms[key].retainedPrunableRules.verifierMatching);
  agree(`${key} accepted all-pass`, c.acceptedBundlesAllPass, work.arms[key].acceptedPassingAllVerifierCases);
  def(`${p}Accepted`, int(c.acceptedBundles));
  def(`${p}AcceptedFailingCase`, int(c.acceptedBundlesFailingSomeCase));
  def(`${p}Units`, int(c.unitsWithPrunedRules));
  def(`${p}Rules`, int(c.prunedRules));
  def(`${p}FireFail`, int(c.firesAndFails));
  def(`${p}FireAllPass`, int(c.firesAllPass));
  def(`${p}Shadowed`, int(c.matchesButShadowed));
  def(`${p}VerifierUnmatched`, int(c.verifierUnmatched));
  def(`${p}Dead`, int(c.dead));
  def(`${p}Firings`, int(c.verifierFiringsOfPrunedRules));
  def(`${p}FiringsPassing`, int(c.verifierFiringsOfPrunedRulesPassing));
}

// ---------------------------------------------------------------- v0.2 pruning harm by domain
section("Post-critique: v0.2 DeepSeek pruning events and harm by domain (research/v02_pruning_by_domain.json)");
{
  const t = v02Domain.totals;
  def("CRVtwoPruneEvents", int(t.pruningEvents));
  def("CRVtwoPruneHarmful", int(t.harmful));
  def("CRVtwoPruneHelpful", int(t.helpful));
  for (const [domain, d] of Object.entries(v02Domain.byDomain)) {
    const p = `CRVtwoPrune${camel(domain)}`;
    def(`${p}Orgs`, int(d.organizations));
    def(`${p}Events`, int(d.pruningEvents));
    def(`${p}Harmful`, int(d.harmful));
    def(`${p}OrgsWithHarm`, int(d.organizationsWithHarm));
    const orgsIn = Object.values(v02Domain.byOrganization).filter((o) => o.domain === domain);
    // Per-organization SC-AUC change from its pruning events, averaged over the
    // organization's seed series (the raw sums sit on rounding boundaries).
    const per = orgsIn.map((o) => o.scAucContributionPerSeries);
    def(`${p}PerSeriesMin`, fix(Math.min(...per)));
    def(`${p}PerSeriesMax`, fix(Math.max(...per)));
  }
}

// ---------------------------------------------------------------- per-organization H3
section("Post-critique: per-organization H3 and model x evidence-gap interaction, not preregistered (research/h3_by_organization_posthoc.json)");
{
  const x = h3Org.modelByGapInteraction;
  def("CRHThreeDSMean", signed(h3Org.h3Mean.deepseek));
  def("CRHThreeGemMean", signed(h3Org.h3Mean.gemini));
  def("CRHThreeInteraction", signed(x.estimate));
  def("CRHThreeInteractionCiLow", signed(x.tInterval95[0]));
  def("CRHThreeInteractionCiHigh", signed(x.tInterval95[1]));
  def("CRHThreeInteractionOrgsPositive", int(x.organizationsPositive));
  def("CRHThreeInteractionOrgs", int(x.organizations));
  for (const [domain, d] of Object.entries(h3Org.byDomain)) {
    const p = `CRHThree${camel(domain)}`;
    def(`${p}DS`, signed(d.meanDeepseekH3));
    def(`${p}Gem`, signed(d.meanGeminiH3));
    def(`${p}Diff`, signed(d.meanGeminiMinusDeepseek));
    def(`${p}SignFlipOrgs`, int(d.organizationsDeepseekNegativeGeminiPositive));
    def(`${p}Orgs`, int(d.organizations.length));
  }
}

const header = [
  "% Generated by scripts/emit-results-cr.mjs -- do not edit by hand.",
  "% Camera-ready POST-HOC analyses added in response to reviews (CLEA #74);",
  "% every input is a zero-model-call replay or re-aggregation of stored runs.",
  "% Arm codes: DSConf = v0.3 DeepSeek, GemConf = v0.3c Gemini, DSDisc = v0.2 DeepSeek,",
  "% DSApprBlind/DSEscBlind = v0.5/v0.5b, GemApprBlind/GemEscBlind = v0.5g/v0.5bg.",
  "",
];
const body = macros.map(([name, value]) => (name === null ? `\n% --- ${value}` : `\\newcommand{\\${name}}{${value}}`));
fs.writeFileSync(path.join(root, "paper/latex/results_cr.tex"), `${header.join("\n")}${body.join("\n").trimStart()}\n`);

// ---------------------------------------------------------------- tables
const LQ = "``"; // LaTeX open quote (backticks cannot appear raw in a template literal)
const TABLE_HEADER = "% Generated by scripts/emit-results-cr.mjs -- do not edit by hand. Requires \\input{results_cr.tex}.\n";
const maskRow = (label, p) => `    ${label} & \\${p}Masks & \\${p}ViolLower & \\${p}ViolEqual & \\${p}ViolHigher & \\${p}DeltaViol & \\${p}DeltaSc \\\\`;
const maskTable = `${TABLE_HEADER}\\begin{table}[t]
  \\caption{\\textbf{Post-hoc, zero model calls; v0.3 DeepSeek only.} Per-mask comparison of BTS with Safe-Subset over the replayed verifier subsets. Each mask's metric is the mean AUC over its \\CRMaskSeriesPerMask{} seed series; ${LQ}lower/equal/higher'' counts masks by the sign of BTS minus Safe-Subset violation-exposure AUC (ties within $10^{-12}$). The first block keeps whole semantic strata (Fig.~1(c) grouping); the full panel is the single six-strata mask and is included in both ${LQ}all'' rows. D3 is the special-approval case. Mean $\\Delta$SC-AUC is never negative for any mask, but BTS has lower SC-AUC than Safe-Subset in \\CRMaskSeriesScLower{} of \\CRMaskSeriesTotal{} individual seed series. The violation sign depends mainly on the escalation case D8 and, when D8 is present, on D3: BTS is never lower with D8 and is higher in every D8 mask that omits D3; of the \\CRMaskHigherTotal{} masks where BTS is higher, \\CRMaskHigherDEightNoDThree{} include D8 and omit D3.}
  \\label{tab:cr-masks}
  \\centering
  \\small
  \\setlength{\\tabcolsep}{3.6pt}
  \\begin{tabular}{lrrrrrr}
    \\toprule
    & & \\multicolumn{3}{c}{BTS violation AUC} & & \\\\
    & & \\multicolumn{3}{c}{vs.\\ Safe-Subset} & & \\\\
    \\cmidrule(lr){3-5}
    Mask group & Masks & Lower & Equal & Higher & Mean $\\Delta$Viol. & Mean $\\Delta$SC \\\\
    \\midrule
${[1, 2, 3, 4, 5, 6].map((n) => maskRow(`${n} of 6 semantic strata`, `CRMaskStrata${WORDS[n]}`)).join("\n")}
    \\midrule
${maskRow("All semantic-strata masks", "CRMaskSemantic")}
${maskRow("All case subsets", "CRMaskAll")}
    \\midrule
${maskRow("D8 (escalation) absent", "CRMaskDEightAbsent")}
${maskRow("D8 (escalation) present", "CRMaskDEightPresent")}
${maskRow("\\quad D8 present, D3 absent", "CRMaskDEightNoDThree")}
${maskRow("\\quad D8 present, D3 present", "CRMaskDEightDThree")}
    \\bottomrule
  \\end{tabular}
\\end{table}
`;
fs.writeFileSync(path.join(root, "paper/latex/cr_table_masks.tex"), maskTable);

const ds03 = work.arms.v03_deepseek;
const workRow = (label, q) => `    ${label} & \\${q}Candidates & \\${q}AcceptRate & \\${q}SubsetEvals & \\${q}BtsEvals & \\${q}Reduction \\\\`;
const workTable = `${TABLE_HEADER}\\begin{table}[t]
  \\caption{\\textbf{Post-hoc accounting from stored run records, zero model calls.} Verifier artifact evaluations by candidate rule count $n$. Safe-Subset tests all $2^n-1$ nonempty subsets of every candidate; BTS tests the complete bundle once and, only if it is rejected, runs the same exhaustive search. Within a rule-count group with bundle acceptance rate $a$ the reduction is exactly $a - 1/(2^n-1)$, so the saving comes from large, usually accepted candidates. Skipping BTS's redundant re-test of the rejected full bundle would give \\CRWorkDSConfBtsNoRetest{} (\\CRWorkDSConfReductionNoRetest{}) in v0.3. Across all arms, generated workflows contain \\CRRuleCountRangeWords{} rules.}
  \\label{tab:cr-verifier-work}
  \\centering
  \\small
  \\setlength{\\tabcolsep}{5pt}
  \\begin{tabular}{lrrrrr}
    \\toprule
    & Candidates & Accept rate $a$ & Safe-Subset evals & BTS evals & Reduction \\\\
    \\midrule
${ds03.byRuleCount.map((r) => workRow(`v0.3 DeepSeek, $n=${r.rules}$`, `CRWorkDSConfN${WORDS[r.rules]}`)).join("\n")}
    \\midrule
${workRow("v0.3 DeepSeek, all", "CRWorkDSConf")}
${workRow("v0.3c Gemini, all", "CRWorkGemConf")}
    \\bottomrule
  \\end{tabular}
\\end{table}
`;
fs.writeFileSync(path.join(root, "paper/latex/cr_table_verifier_work.tex"), workTable);

const RET_ARMS = ["DSConf", "GemConf", "DSApprBlind", "DSEscBlind", "GemApprBlind", "GemEscBlind"];
const retRow = (label, field) => `    ${label} & ${RET_ARMS.map((a) => `\\CRRetain${a}${field}`).join(" & ")} \\\\`;
const retTable = `${TABLE_HEADER}\\begin{table}[t]
  \\caption{\\textbf{Post-hoc replay of stored candidates, zero model calls.} Cost of keeping the accepted bundle, on accepted units only, where Bundle and BTS release the bundle and Safe-Subset releases its pruned subset; per-task quantities are computed on the same units for both gates (unit-weighted, except multi-match shares, which are pooled over tasks). A pre-emption is a hidden task on which a retained rule fires before a rule Safe-Subset kept. In v0.3 DeepSeek the \\CRRetainDSConfFirings{} firings of retained rules are \\CRRetainDSConfOutcomeEscalationIncorrect{} incorrect escalations, \\CRRetainDSConfOutcomeApprovalIncorrect{} incorrect approval requests, \\CRRetainDSConfOutcomeActionFunctionalFailure{} functional failures and \\CRRetainDSConfOutcomeExplicitAbstention{} explicit abstentions, all policy-safe; Safe-Subset turns them into no-rule-match, and VAC and SC-VAC are unchanged in all \\CRRetainDSConfPrunedUnits{} pruned units. Dead rules match no verifier case and no hidden case even when executed alone. Latency and memory are not measured.}
  \\label{tab:cr-retention}
  \\centering
  \\small
  \\setlength{\\tabcolsep}{2.8pt}
  \\begin{tabular}{lrrrrrr}
    \\toprule
    & \\multicolumn{2}{c}{Confirmatory} & \\multicolumn{2}{c}{DeepSeek stress} & \\multicolumn{2}{c}{Gemini stress} \\\\
    \\cmidrule(lr){2-3}\\cmidrule(lr){4-5}\\cmidrule(lr){6-7}
    & DeepSeek & Gemini & Appr.-blind & Esc.-blind & Appr.-blind & Esc.-blind \\\\
    \\midrule
${retRow("Accepted units", "AcceptedUnits")}
${retRow("Rules released, Bundle/BTS", "RulesBundle")}
${retRow("Rules released, Safe-Subset", "RulesSubset")}
${retRow("Extra rules kept", "ExtraRulesPct")}
${retRow("Units Safe-Subset prunes", "PrunedUnits")}
${retRow("Cond. evals/task, Bundle/BTS", "CondBundle")}
${retRow("Cond. evals/task, Safe-Subset", "CondSubset")}
${retRow("Tasks with $>1$ match, Bundle/BTS", "MultiBundle")}
${retRow("Tasks with $>1$ match, Safe-Subset", "MultiSubset")}
${retRow("Pre-emptions of a kept rule", "Preempt")}
    \\midrule
${retRow("Hidden firings of retained rules", "Firings")}
${retRow("\\quad automated passes", "FiringPasses")}
${retRow("\\quad policy violations", "FiringPolicyFail")}
${retRow("\\quad policy-safe non-passes", "FiringPolicySafeNonPass")}
${retRow("Dead rules in accepted bundles", "DeadRules")}
    \\bottomrule
  \\end{tabular}
\\end{table}
`;
fs.writeFileSync(path.join(root, "paper/latex/cr_table_retention.tex"), retTable);

process.stdout.write(`Wrote ${seen.size} \\CR macros to paper/latex/results_cr.tex and 3 table snippets.\n`);
