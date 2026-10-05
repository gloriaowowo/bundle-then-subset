// Retrospective v0.2 reconstruction of Bundle-then-Subset from aggregate gate
// outputs. This analysis generated the v0.3 hypothesis and is not confirmatory.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const runSet = JSON.parse(await readFile(
  path.join(process.cwd(), "research", "robustness_v02_hidden_run_set.json"),
  "utf8",
));
const outputPath = path.join(process.cwd(), "research", "robustness_v02_posthoc_hybrid_summary.json");
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function auc(points, key) {
  const ordered = [...points].sort((left, right) => left.x - right.x);
  let area = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    area += (ordered[index].x - ordered[index - 1].x) *
      (ordered[index][key] + ordered[index - 1][key]) / 2;
  }
  return area;
}

function randomGenerator(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function percentile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function effect(values) {
  const grouped = new Map();
  for (const item of values) {
    const records = grouped.get(item.organizationId) ?? [];
    records.push(item.value);
    grouped.set(item.organizationId, records);
  }
  const clusters = [...grouped.values()].map(mean);
  const random = randomGenerator(20_260_822);
  const bootstrap = Array.from({ length: 10_000 }, () => mean(Array.from(
    { length: clusters.length },
    () => clusters[Math.floor(random() * clusters.length)],
  ))).sort((left, right) => left - right);
  return {
    estimate: mean(values.map((item) => item.value)),
    organizationClusterBootstrap95: [percentile(bootstrap, 0.025), percentile(bootstrap, 0.975)],
    organizationCount: clusters.length,
    pairedSeriesCount: values.length,
  };
}

const groups = new Map();
const routeCounts = { bundle_accepted: 0, subset_recovery: 0, complete_abstention: 0 };
for (const runId of runSet.runIds) {
  const aggregate = JSON.parse(await readFile(path.join(process.cwd(), "runs", runId, "aggregate.json"), "utf8"));
  const direct = aggregate.gateEvaluations.find((item) => item.gate === "direct" && item.verifier.strategy === "full");
  const bundle = aggregate.gateEvaluations.find((item) => item.gate === "bundle" && item.verifier.strategy === "full");
  const subset = aggregate.gateEvaluations.find((item) => item.gate === "safe-subset" && item.verifier.strategy === "full");
  const hybrid = bundle.promotion.promotedRuleCount > 0 ? bundle : subset;
  if (aggregate.checkpoint > 0) {
    if (bundle.promotion.promotedRuleCount > 0) routeCounts.bundle_accepted += 1;
    else if (subset.promotion.promotedRuleCount > 0) routeCounts.subset_recovery += 1;
    else routeCounts.complete_abstention += 1;
  }
  const key = `${aggregate.organizationId}:${aggregate.evidenceRegime}:${aggregate.trialSeed}`;
  const points = groups.get(key) ?? [];
  points.push({
    x: aggregate.evidenceFraction,
    organizationId: aggregate.organizationId,
    hybridRaw: hybrid.verifiedAutomationCoverage,
    hybridSc: hybrid.safetyConstrainedVac,
    hybridViolation: 1 - hybrid.policyPassRate,
    directRaw: direct.verifiedAutomationCoverage,
    directSc: direct.safetyConstrainedVac,
    directViolation: 1 - direct.policyPassRate,
    bundleRaw: bundle.verifiedAutomationCoverage,
    bundleSc: bundle.safetyConstrainedVac,
  });
  groups.set(key, points);
}

const series = [...groups.values()].map((points) => ({
  organizationId: points[0].organizationId,
  hybridRaw: auc(points, "hybridRaw"),
  hybridSc: auc(points, "hybridSc"),
  hybridViolation: auc(points, "hybridViolation"),
  directRaw: auc(points, "directRaw"),
  directSc: auc(points, "directSc"),
  directViolation: auc(points, "directViolation"),
  bundleRaw: auc(points, "bundleRaw"),
  bundleSc: auc(points, "bundleSc"),
  finalHybrid: [...points].sort((left, right) => left.x - right.x).at(-1).hybridRaw,
}));
const paired = (treatment, baseline) => effect(series.map((item) => ({
  organizationId: item.organizationId,
  value: item[treatment] - item[baseline],
})));
const nonzeroPoints = Object.values(routeCounts).reduce((sum, value) => sum + value, 0);
const output = {
  schemaVersion: 1,
  scientificStatus: "post-hoc-aggregate-only-hypothesis-generation",
  meanHybridRawVacAuc: mean(series.map((item) => item.hybridRaw)),
  meanHybridSafetyConstrainedVacAuc: mean(series.map((item) => item.hybridSc)),
  meanHybridViolationExposureAuc: mean(series.map((item) => item.hybridViolation)),
  meanHybridFinalRawVac: mean(series.map((item) => item.finalHybrid)),
  effects: {
    hybridMinusBundleScAuc: paired("hybridSc", "bundleSc"),
    hybridMinusDirectScAuc: paired("hybridSc", "directSc"),
    hybridMinusDirectRawAuc: paired("hybridRaw", "directRaw"),
    hybridMinusDirectViolationExposureAuc: paired("hybridViolation", "directViolation"),
  },
  routeRatesExcludingZeroCheckpoint: Object.fromEntries(
    Object.entries(routeCounts).map(([route, count]) => [route, count / nonzeroPoints]),
  ),
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status: "complete", outputPath, ...output }, null, 2)}\n`);

