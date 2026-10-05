// Post-hoc, aggregate-only diagnostic. This script is not part of the frozen
// confirmatory analysis and must not be used to redefine H1--H4.
import { readFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();
const runSet = JSON.parse(await readFile(
  path.join(workspaceRoot, "research", "robustness_v02_hidden_run_set.json"),
  "utf8",
));
const weights = new Map([[0, 0.125], [8, 0.25], [16, 0.25], [24, 0.25], [32, 0.125]]);
const seriesCount =
  runSet.organizations.length * runSet.evidenceRegimes.length * runSet.trialSeeds.length;
const buckets = new Map();

for (const runId of runSet.runIds) {
  const aggregate = JSON.parse(await readFile(
    path.join(workspaceRoot, "runs", runId, "aggregate.json"),
    "utf8",
  ));
  if (aggregate.checkpoint === 0) continue;
  const bundle = aggregate.gateEvaluations.find((item) =>
    item.gate === "bundle" && item.verifier.strategy === "full",
  );
  const subset = aggregate.gateEvaluations.find((item) =>
    item.gate === "safe-subset" && item.verifier.strategy === "full",
  );
  let bucket = "unchanged";
  if (bundle.promotion.promotedRuleCount === 0 && subset.promotion.promotedRuleCount > 0) {
    bucket = "subset_rescue";
  } else if (
    bundle.promotion.promotedRuleCount > 0 &&
    subset.promotion.promotedRuleCount < bundle.promotion.promotedRuleCount
  ) {
    bucket = "subset_prunes_accepted_bundle";
  } else if (
    bundle.promotion.promotedRuleCount === 0 &&
    subset.promotion.promotedRuleCount === 0
  ) {
    bucket = "both_abstain";
  }
  const records = buckets.get(bucket) ?? [];
  records.push({
    domain: aggregate.domain,
    checkpoint: aggregate.checkpoint,
    candidateRuleCount: aggregate.candidateRuleCount,
    bundleRules: bundle.promotion.promotedRuleCount,
    subsetRules: subset.promotion.promotedRuleCount,
    equalDevelopmentPasses:
      bundle.promotion.developmentAutomatedPasses ===
      subset.promotion.developmentAutomatedPasses,
    rawDifference: subset.verifiedAutomationCoverage - bundle.verifiedAutomationCoverage,
    safetyDifference: subset.safetyConstrainedVac - bundle.safetyConstrainedVac,
    subsetPolicyFailures: subset.policyFailureCount,
    weight: weights.get(aggregate.checkpoint),
  });
  buckets.set(bucket, records);
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const output = {
  scientificStatus: "post-hoc-aggregate-only-diagnostic",
  buckets: Object.fromEntries([...buckets.entries()].map(([name, records]) => [name, {
    checkpointUnits: records.length,
    fractionOfNonzeroCheckpointUnits: records.length / 384,
    meanRulesRemovedFromBundle: mean(records.map((item) => item.bundleRules - item.subsetRules)),
    equalDevelopmentPassRate: mean(records.map((item) => Number(item.equalDevelopmentPasses))),
    meanHiddenRawDifference: mean(records.map((item) => item.rawDifference)),
    meanHiddenSafetyDifference: mean(records.map((item) => item.safetyDifference)),
    safetyAucContribution: records.reduce(
      (sum, item) => sum + item.weight * item.safetyDifference,
      0,
    ) / seriesCount,
    hiddenSubsetPolicyFailures: records.reduce(
      (sum, item) => sum + item.subsetPolicyFailures,
      0,
    ),
    byDomain: Object.fromEntries(["support", "procurement"].map((domain) => [
      domain,
      records.filter((item) => item.domain === domain).length,
    ])),
  }])),
};
output.netSafetyAucDifference = Object.values(output.buckets).reduce(
  (sum, item) => sum + item.safetyAucContribution,
  0,
);
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
