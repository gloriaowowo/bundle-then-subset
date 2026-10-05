// Aggregate-only post-hoc diagnostic. This file is outside the frozen v0.3
// implementation and must not redefine H1--H3 or their confirmatory intervals.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { OUTCOME_CLASSES } from "../experiments/v03/outcomes.mjs";

const runSetPath = path.join(process.cwd(), "research", "robustness_v03_deepseek-deepseek-v4-pro_hidden_run_set.json");
const outputPath = path.join(process.cwd(), "research", "robustness_v03_posthoc_domain_behavior.json");
const runSet = JSON.parse(await readFile(runSetPath, "utf8"));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function auc(points, accessor) {
  const sorted = [...points].sort((left, right) => left.x - right.x);
  let area = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    area += (sorted[index].x - sorted[index - 1].x) *
      (accessor(sorted[index]) + accessor(sorted[index - 1])) / 2;
  }
  return area;
}

function seededRandom(seed) {
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

function summarize(values) {
  const grouped = new Map();
  for (const item of values) {
    const records = grouped.get(item.organizationId) ?? [];
    records.push(item.value);
    grouped.set(item.organizationId, records);
  }
  const clusters = [...grouped.values()].map(mean);
  const random = seededRandom(20_260_823);
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
for (const runId of runSet.runIds) {
  const aggregate = JSON.parse(await readFile(path.join(process.cwd(), "runs", runId, "aggregate.json"), "utf8"));
  for (const evaluation of aggregate.gateEvaluations) {
    const key = [
      aggregate.organizationId,
      aggregate.domain,
      aggregate.evidenceRegime,
      aggregate.trialSeed,
      evaluation.gate,
    ].join(":");
    const points = groups.get(key) ?? [];
    points.push({
      x: aggregate.evidenceFraction,
      organizationId: aggregate.organizationId,
      domain: aggregate.domain,
      gap: aggregate.authoritativeEvidenceGapBatches,
      seed: aggregate.trialSeed,
      gate: evaluation.gate,
      raw: evaluation.verifiedAutomationCoverage,
      sc: evaluation.safetyConstrainedVac,
      violation: 1 - evaluation.policyPassRate,
      outcomes: evaluation.outcomeRates,
    });
    groups.set(key, points);
  }
}

const series = [...groups.values()].map((points) => ({
  organizationId: points[0].organizationId,
  domain: points[0].domain,
  gap: points[0].gap,
  seed: points[0].seed,
  gate: points[0].gate,
  raw: auc(points, (point) => point.raw),
  sc: auc(points, (point) => point.sc),
  violation: auc(points, (point) => point.violation),
  outcomes: Object.fromEntries(OUTCOME_CLASSES.map((outcome) => [
    outcome,
    auc(points, (point) => point.outcomes[outcome]),
  ])),
}));
const key = (item) => `${item.organizationId}:${item.seed}`;

function contrast(treatment, baseline, accessor) {
  const baselineMap = new Map(baseline.map((item) => [key(item), item]));
  return treatment.map((item) => ({
    organizationId: item.organizationId,
    value: accessor(item) - accessor(baselineMap.get(key(item))),
  }));
}

function gapContrast(gap, metric, domain) {
  const selected = series.filter((item) => item.gate === "direct" && (!domain || item.domain === domain));
  return summarize(contrast(
    selected.filter((item) => item.gap === gap),
    selected.filter((item) => item.gap === 0),
    (item) => item[metric],
  ));
}

function gateContrast(gate, baselineGate, metric, domain) {
  const selected = series.filter((item) => !domain || item.domain === domain);
  const baselineMap = new Map(selected.filter((item) => item.gate === baselineGate).map((item) => [
    `${item.organizationId}:${item.gap}:${item.seed}`,
    item,
  ]));
  const values = selected.filter((item) => item.gate === gate).map((item) => ({
    organizationId: item.organizationId,
    value: item[metric] - baselineMap.get(`${item.organizationId}:${item.gap}:${item.seed}`)[metric],
  }));
  return summarize(values);
}

const gap1OutcomeEffects = Object.fromEntries(OUTCOME_CLASSES.map((outcome) => {
  const selected = series.filter((item) => item.gate === "direct");
  return [outcome, summarize(contrast(
    selected.filter((item) => item.gap === 1),
    selected.filter((item) => item.gap === 0),
    (item) => item.outcomes[outcome],
  ))];
}));

const output = {
  schemaVersion: 1,
  scientificStatus: "post-hoc-aggregate-only-diagnostic",
  gateEffectsByDomain: Object.fromEntries(["expense", "access"].map((domain) => [domain, {
    hybridMinusBundleScAuc: gateContrast("bundle-then-subset", "bundle", "sc", domain),
    hybridMinusDirectRawAuc: gateContrast("bundle-then-subset", "direct", "raw", domain),
    hybridMinusDirectViolationAuc: gateContrast("bundle-then-subset", "direct", "violation", domain),
    hybridMinusSafeSubsetScAuc: gateContrast("bundle-then-subset", "safe-subset", "sc", domain),
  }])),
  evidenceGapEffectsByDomain: Object.fromEntries(["expense", "access"].map((domain) => [domain, {
    gap1MinusGap0DirectRawAuc: gapContrast(1, "raw", domain),
    gap1MinusGap0DirectViolationAuc: gapContrast(1, "violation", domain),
    gap3MinusGap0DirectRawAuc: gapContrast(3, "raw", domain),
    gap3MinusGap0DirectViolationAuc: gapContrast(3, "violation", domain),
  }])),
  pooledGap1MinusGap0: {
    rawAuc: gapContrast(1, "raw"),
    violationExposureAuc: gapContrast(1, "violation"),
    outcomeRateAuc: gap1OutcomeEffects,
  },
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status: "complete", outputPath, ...output }, null, 2)}\n`);

