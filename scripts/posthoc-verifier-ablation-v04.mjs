import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { hashArtifact } from "../dist/eval/manifest.js";
import { applyPromotionGate } from "../dist/methods/promotion.js";
import { createOrganizations } from "../experiments/v03/benchmark.mjs";
import { evaluateWorkflowAggregate } from "../experiments/v03/outcomes.mjs";

const RUN_SET_PATH = "research/robustness_v03_deepseek-deepseek-v4-pro_hidden_run_set.json";
const V03_SUMMARY_PATH = "research/robustness_v03_deepseek_hidden_summary.json";
const OUTPUT_PATH = "research/robustness_v04_verifier_ablation.json";
const FULL_MASK = (1 << 8) - 1;
const GATES = ["bundle", "safe-subset", "bundle-then-subset"];
const METRICS = [
  "rawVacAuc",
  "safetyConstrainedVacAuc",
  "violationExposureAuc",
  "functionalAuc",
];
const DEVELOPMENT_CASE_LABELS = [
  "D1 standard low-value automatic decision",
  "D2 standard over-threshold approval decision",
  "D3 special over-threshold approval decision",
  "D4 standard automatic workflow execution",
  "D5 special automatic workflow execution",
  "D6 standard within-threshold policy edge",
  "D7 special at-threshold policy edge",
  "D8 ineligible special-request escalation",
];
const SEMANTIC_STRATA = [
  { id: "S1", label: "standard interior automatic", caseIndices: [0, 3] },
  { id: "S2", label: "standard just-below-boundary automatic", caseIndices: [5] },
  { id: "S3", label: "standard over-threshold approval", caseIndices: [1] },
  { id: "S4", label: "special at-boundary automatic", caseIndices: [4, 6] },
  { id: "S5", label: "special over-threshold approval", caseIndices: [2] },
  { id: "S6", label: "ineligible special-request escalation", caseIndices: [7] },
].map((stratum) => ({
  ...stratum,
  caseMask: stratum.caseIndices.reduce((mask, index) => mask | (1 << index), 0),
}));

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const nearlyEqual = (left, right, tolerance = 1e-12) => Math.abs(left - right) <= tolerance;
const popcount = (value) => {
  let count = 0;
  for (let current = value; current > 0; current >>>= 1) count += current & 1;
  return count;
};

function auc(points, key) {
  const ordered = [...points].sort((left, right) => left.evidenceFraction - right.evidenceFraction);
  const expected = [0, 0.25, 0.5, 0.75, 1];
  if (
    ordered.length !== expected.length ||
    ordered.some((point, index) => point.evidenceFraction !== expected[index])
  ) throw new Error("Incomplete acquisition curve.");
  let area = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    area += (current.evidenceFraction - previous.evidenceFraction) *
      (current[key] + previous[key]) / 2;
  }
  return area;
}

function selectDevelopmentTasks(tasks, mask) {
  if (tasks.length !== 8) throw new Error("The v0.4 stress test requires exactly eight development cases.");
  return tasks.filter((_, index) => (mask & (1 << index)) !== 0);
}

function compactEvaluation(evaluation) {
  return {
    rawVac: evaluation.verifiedAutomationCoverage,
    safetyConstrainedVac: evaluation.safetyConstrainedVac,
    functional: evaluation.functionalPassRate,
    violationExposure: 1 - evaluation.policyPassRate,
    groundingFailureExposure: 1 - evaluation.groundingPassRate,
  };
}

function evaluate(candidate, activeWorkflow, organization, visibleEvidence, suffix) {
  return evaluateWorkflowAggregate({
    candidate,
    activeWorkflow,
    tasks: organization.hiddenTasks,
    visibleEvidence,
    tools: organization.tools,
    idSuffix: suffix,
  });
}

function seriesKey(point) {
  return [
    point.organizationId,
    point.evidenceRegime,
    point.trialSeed,
    point.mask,
    point.gate,
  ].join(":");
}

function basePairKey(item) {
  return [item.organizationId, item.evidenceRegime, item.trialSeed, item.mask].join(":");
}

function summarizeSeries(selected) {
  const result = {
    seriesCount: selected.length,
    organizationCount: new Set(selected.map((item) => item.organizationId)).size,
  };
  for (const metric of METRICS) result[`mean${metric[0].toUpperCase()}${metric.slice(1)}`] = mean(selected.map((item) => item[metric]));
  result.meanFinalRawVac = mean(selected.map((item) => item.finalRawVac));
  result.meanFinalSafetyConstrainedVac = mean(selected.map((item) => item.finalSafetyConstrainedVac));
  result.meanFinalViolationExposure = mean(selected.map((item) => item.finalViolationExposure));
  return result;
}

function pairedDelta(treatment, baseline, metric) {
  const baselineMap = new Map(baseline.map((item) => [basePairKey(item), item]));
  const values = treatment.map((item) => item[metric] - baselineMap.get(basePairKey(item))[metric]);
  return mean(values);
}

function confusionRates(counts) {
  const positive = counts.truePositive + counts.falseNegative;
  const negative = counts.trueNegative + counts.falsePositive;
  const accepted = counts.truePositive + counts.falsePositive;
  return {
    ...counts,
    falsePositiveRate: negative === 0 ? null : counts.falsePositive / negative,
    falseAcceptanceRate: negative === 0 ? null : counts.falsePositive / negative,
    falseNegativeRate: positive === 0 ? null : counts.falseNegative / positive,
    acceptedHiddenFailureRate: accepted === 0 ? null : counts.falsePositive / accepted,
    accuracy: (counts.truePositive + counts.trueNegative) /
      (counts.truePositive + counts.trueNegative + counts.falsePositive + counts.falseNegative),
  };
}

function emptyConfusion() {
  return { truePositive: 0, trueNegative: 0, falsePositive: 0, falseNegative: 0 };
}

const workspaceRoot = process.cwd();
const [runSet, v03Summary] = await Promise.all([
  readFile(path.join(workspaceRoot, RUN_SET_PATH), "utf8").then(JSON.parse),
  readFile(path.join(workspaceRoot, V03_SUMMARY_PATH), "utf8").then(JSON.parse),
]);
if (runSet.evaluationSplit !== "hidden" || runSet.runIds.length !== 480) {
  throw new Error("Expected the frozen 480-unit v0.3 hidden run set.");
}

const organizationsByRegime = new Map(runSet.evidenceRegimes.map((regime) => [
  regime,
  new Map(createOrganizations(regime).map((organization) => [organization.id, organization])),
]));
const pointGroups = new Map();
const routeCounts = new Map();
const confusionBySize = new Map(Array.from({ length: 8 }, (_, index) => [index + 1, emptyConfusion()]));
const confusionByMask = new Map(Array.from({ length: FULL_MASK }, (_, index) => [index + 1, emptyConfusion()]));
let fullVerifierUnitMismatches = 0;
let generatedCandidateUnits = 0;
const uniqueCandidateHashes = new Set();
let minimumCandidateRules = Number.POSITIVE_INFINITY;
let maximumCandidateRules = 0;

for (let unitIndex = 0; unitIndex < runSet.runIds.length; unitIndex += 1) {
  const runId = runSet.runIds[unitIndex];
  if (!/^[a-zA-Z0-9._-]+$/.test(runId)) throw new Error(`Unsafe run ID ${runId}.`);
  const directory = path.join(workspaceRoot, "runs", runId);
  const [aggregate, artifacts, manifest] = await Promise.all([
    readFile(path.join(directory, "aggregate.json"), "utf8").then(JSON.parse),
    readFile(path.join(directory, "artifacts.json"), "utf8").then(JSON.parse),
    readFile(path.join(directory, "manifest.json"), "utf8").then(JSON.parse),
  ]);
  if (
    manifest.hashes.aggregate !== hashArtifact(aggregate) ||
    manifest.hashes.artifacts !== hashArtifact(artifacts) ||
    aggregate.runStatus !== "valid" || aggregate.evaluationSplit !== "hidden"
  ) throw new Error(`Invalid frozen unit ${runId}.`);
  const candidate = artifacts.candidate ?? undefined;
  if ((candidate ? hashArtifact(candidate) : null) !== aggregate.candidateHash) {
    throw new Error(`Candidate hash mismatch in ${runId}.`);
  }
  if (candidate) {
    generatedCandidateUnits += 1;
    uniqueCandidateHashes.add(aggregate.candidateHash);
    minimumCandidateRules = Math.min(minimumCandidateRules, candidate.rules.length);
    maximumCandidateRules = Math.max(maximumCandidateRules, candidate.rules.length);
  }
  const organization = organizationsByRegime.get(aggregate.evidenceRegime).get(aggregate.organizationId);
  if (!organization) throw new Error(`Missing organization ${aggregate.organizationId}.`);
  const visibleEvidence = organization.evidence.slice(0, aggregate.checkpoint);
  const evidenceIds = new Set(visibleEvidence.map((item) => item.id));
  const storedByGate = new Map(aggregate.gateEvaluations.map((item) => [item.gate, item]));
  const directStored = storedByGate.get("direct");
  const hiddenSafeUseful = Boolean(candidate) && directStored.verifiedAutomationCoverage > 0 &&
    directStored.policyPassRate === 1 && directStored.groundingPassRate === 1;

  for (let mask = 1; mask <= FULL_MASK; mask += 1) {
    const verifierSize = popcount(mask);
    const developmentTasks = selectDevelopmentTasks(organization.developmentTasks, mask);
    const bundleDecision = applyPromotionGate(candidate, "bundle", developmentTasks, organization.tools, evidenceIds);
    const subsetDecision = applyPromotionGate(candidate, "safe-subset", developmentTasks, organization.tools, evidenceIds);
    const activeByGate = {
      bundle: bundleDecision.activeWorkflow,
      "safe-subset": subsetDecision.activeWorkflow,
      "bundle-then-subset": bundleDecision.activeWorkflow ?? subsetDecision.activeWorkflow,
    };
    const routeByGate = {
      bundle: bundleDecision.activeWorkflow ? "bundle_accepted" : "bundle_abstained",
      "safe-subset": subsetDecision.activeWorkflow ? "safe-subset_accepted" : "safe-subset_abstained",
      "bundle-then-subset": bundleDecision.activeWorkflow
        ? "bundle_accepted"
        : subsetDecision.activeWorkflow ? "subset_recovery" : "complete_abstention",
    };

    if (candidate) {
      const accepted = Boolean(bundleDecision.activeWorkflow);
      const outcome = accepted
        ? hiddenSafeUseful ? "truePositive" : "falsePositive"
        : hiddenSafeUseful ? "falseNegative" : "trueNegative";
      confusionBySize.get(verifierSize)[outcome] += 1;
      confusionByMask.get(mask)[outcome] += 1;
    }

    for (const gate of GATES) {
      const fullEvaluation = evaluate(
        candidate,
        activeByGate[gate],
        organization,
        visibleEvidence,
        `v04-${mask}-${gate}`,
      );
      const metrics = compactEvaluation(fullEvaluation);
      const point = {
        organizationId: aggregate.organizationId,
        domain: aggregate.domain,
        evidenceRegime: aggregate.evidenceRegime,
        trialSeed: aggregate.trialSeed,
        checkpoint: aggregate.checkpoint,
        evidenceFraction: aggregate.evidenceFraction,
        mask,
        verifierSize,
        gate,
        route: routeByGate[gate],
        ...metrics,
      };
      const key = seriesKey(point);
      const points = pointGroups.get(key) ?? [];
      points.push(point);
      pointGroups.set(key, points);
      if (aggregate.checkpoint > 0) {
        const routeKey = `${verifierSize}:${gate}:${point.route}`;
        routeCounts.set(routeKey, (routeCounts.get(routeKey) ?? 0) + 1);
      }

      if (mask === FULL_MASK) {
        const storedGate = storedByGate.get(gate);
        const decision = gate === "bundle"
          ? bundleDecision
          : gate === "safe-subset" ? subsetDecision
          : { activeWorkflow: activeByGate[gate] };
        const reconstructedWorkflowHash = decision.activeWorkflow ? hashArtifact(decision.activeWorkflow) : undefined;
        if (
          !nearlyEqual(metrics.rawVac, storedGate.verifiedAutomationCoverage) ||
          !nearlyEqual(metrics.safetyConstrainedVac, storedGate.safetyConstrainedVac) ||
          !nearlyEqual(metrics.violationExposure, 1 - storedGate.policyPassRate) ||
          reconstructedWorkflowHash !== storedGate.promotion.activeWorkflowHash ||
          JSON.stringify(fullEvaluation.outcomeCounts) !== JSON.stringify(storedGate.outcomeCounts)
        ) fullVerifierUnitMismatches += 1;
      }
    }
  }
  if ((unitIndex + 1) % 40 === 0) process.stderr.write(`processed ${unitIndex + 1}/480 units\n`);
}

if (fullVerifierUnitMismatches !== 0) {
  throw new Error(`Full-verifier reconstruction mismatched ${fullVerifierUnitMismatches} gate-unit results.`);
}

const series = [...pointGroups.values()].map((points) => {
  const first = points[0];
  const final = points.find((point) => point.evidenceFraction === 1);
  return {
    organizationId: first.organizationId,
    domain: first.domain,
    evidenceRegime: first.evidenceRegime,
    trialSeed: first.trialSeed,
    mask: first.mask,
    verifierSize: first.verifierSize,
    gate: first.gate,
    rawVacAuc: auc(points, "rawVac"),
    safetyConstrainedVacAuc: auc(points, "safetyConstrainedVac"),
    violationExposureAuc: auc(points, "violationExposure"),
    functionalAuc: auc(points, "functional"),
    finalRawVac: final.rawVac,
    finalSafetyConstrainedVac: final.safetyConstrainedVac,
    finalViolationExposure: final.violationExposure,
  };
});

const directV03 = v03Summary.byGate.find((item) => item.gate === "direct");
const byVerifierSize = [];
for (let verifierSize = 1; verifierSize <= 8; verifierSize += 1) {
  const maskCount = Array.from({ length: FULL_MASK }, (_, index) => index + 1)
    .filter((mask) => popcount(mask) === verifierSize).length;
  const selectedByGate = Object.fromEntries(GATES.map((gate) => [
    gate,
    series.filter((item) => item.verifierSize === verifierSize && item.gate === gate),
  ]));
  const bundle = selectedByGate.bundle;
  const subset = selectedByGate["safe-subset"];
  const hybrid = selectedByGate["bundle-then-subset"];
  const nonzeroPointDenominator = 8 * 4 * 3 * 4 * maskCount;
  const routeRates = Object.fromEntries(GATES.map((gate) => [gate, Object.fromEntries(
    [...new Set([...routeCounts.keys()]
      .filter((key) => key.startsWith(`${verifierSize}:${gate}:`))
      .map((key) => key.split(":").at(-1)))]
      .map((route) => [route, (routeCounts.get(`${verifierSize}:${gate}:${route}`) ?? 0) / nonzeroPointDenominator]),
  )]));
  byVerifierSize.push({
    verifierSize,
    maskCount,
    directReference: {
      meanRawVacAuc: directV03.meanRawVacAuc,
      meanSafetyConstrainedVacAuc: directV03.meanSafetyConstrainedVacAuc,
      meanViolationExposureAuc: directV03.meanViolationExposureAuc,
      meanFinalRawVac: directV03.meanFinalRawVac,
      meanFinalSafetyConstrainedVac: directV03.meanFinalSafetyConstrainedVac,
    },
    gates: Object.fromEntries(GATES.map((gate) => [gate, summarizeSeries(selectedByGate[gate])])),
    pairedDeltas: {
      hybridMinusBundleSafetyConstrainedVacAuc: pairedDelta(hybrid, bundle, "safetyConstrainedVacAuc"),
      hybridMinusBundleRawVacAuc: pairedDelta(hybrid, bundle, "rawVacAuc"),
      hybridMinusBundleViolationExposureAuc: pairedDelta(hybrid, bundle, "violationExposureAuc"),
      hybridMinusSafeSubsetSafetyConstrainedVacAuc: pairedDelta(hybrid, subset, "safetyConstrainedVacAuc"),
      hybridMinusSafeSubsetRawVacAuc: pairedDelta(hybrid, subset, "rawVacAuc"),
      hybridMinusSafeSubsetViolationExposureAuc: pairedDelta(hybrid, subset, "violationExposureAuc"),
    },
    bundleVerifierConfusion: confusionRates(confusionBySize.get(verifierSize)),
    routeRatesExcludingZeroCheckpoint: routeRates,
  });
}

const leaveOneOut = DEVELOPMENT_CASE_LABELS.map((caseLabel, missingIndex) => {
  const mask = FULL_MASK & ~(1 << missingIndex);
  const selectedByGate = Object.fromEntries(GATES.map((gate) => [
    gate,
    series.filter((item) => item.mask === mask && item.gate === gate),
  ]));
  return {
    omittedCase: `D${missingIndex + 1}`,
    caseLabel,
    mask,
    gates: Object.fromEntries(GATES.map((gate) => [gate, summarizeSeries(selectedByGate[gate])])),
    bundleVerifierConfusion: confusionRates(confusionByMask.get(mask)),
  };
});

function summarizeMasks(masks) {
  const maskSet = new Set(masks);
  const selectedByGate = Object.fromEntries(GATES.map((gate) => [
    gate,
    series.filter((item) => maskSet.has(item.mask) && item.gate === gate),
  ]));
  const bundle = selectedByGate.bundle;
  const subset = selectedByGate["safe-subset"];
  const hybrid = selectedByGate["bundle-then-subset"];
  const confusion = masks.reduce((counts, mask) => {
    const current = confusionByMask.get(mask);
    for (const key of Object.keys(counts)) counts[key] += current[key];
    return counts;
  }, emptyConfusion());
  return {
    maskCount: masks.length,
    gates: Object.fromEntries(GATES.map((gate) => [gate, summarizeSeries(selectedByGate[gate])])),
    pairedDeltas: {
      hybridMinusBundleSafetyConstrainedVacAuc: pairedDelta(hybrid, bundle, "safetyConstrainedVacAuc"),
      hybridMinusBundleViolationExposureAuc: pairedDelta(hybrid, bundle, "violationExposureAuc"),
      hybridMinusSafeSubsetSafetyConstrainedVacAuc: pairedDelta(hybrid, subset, "safetyConstrainedVacAuc"),
      hybridMinusSafeSubsetViolationExposureAuc: pairedDelta(hybrid, subset, "violationExposureAuc"),
    },
    bundleVerifierConfusion: confusionRates(confusion),
  };
}

const semanticMasks = [];
for (let stratumMask = 1; stratumMask < (1 << SEMANTIC_STRATA.length); stratumMask += 1) {
  const retained = SEMANTIC_STRATA.filter((_, index) => (stratumMask & (1 << index)) !== 0);
  semanticMasks.push({
    stratumMask,
    retainedStrata: retained.map((stratum) => stratum.id),
    retainedStratumCount: retained.length,
    caseMask: retained.reduce((mask, stratum) => mask | stratum.caseMask, 0),
  });
}
const bySemanticStratumCount = Array.from({ length: SEMANTIC_STRATA.length }, (_, index) => index + 1)
  .map((retainedStratumCount) => {
    const selected = semanticMasks.filter((item) => item.retainedStratumCount === retainedStratumCount);
    return {
      retainedStratumCount,
      ...summarizeMasks(selected.map((item) => item.caseMask)),
    };
  });

const BASE_CASE_MASK = [0, 1, 2, 3, 4].reduce((mask, index) => mask | (1 << index), 0);
const EDGE_CASE_INDICES = [5, 6, 7];
const edgeFactorialMasks = Array.from({ length: 1 << EDGE_CASE_INDICES.length }, (_, edgeMask) => ({
  retainedEdgeCount: popcount(edgeMask),
  caseMask: EDGE_CASE_INDICES.reduce(
    (mask, caseIndex, edgeIndex) => mask | ((edgeMask & (1 << edgeIndex)) ? (1 << caseIndex) : 0),
    BASE_CASE_MASK,
  ),
}));
const byRetainedPolicyEdgeCount = Array.from({ length: 4 }, (_, retainedEdgeCount) => {
  const selected = edgeFactorialMasks.filter((item) => item.retainedEdgeCount === retainedEdgeCount);
  return {
    retainedEdgeCount,
    ...summarizeMasks(selected.map((item) => item.caseMask)),
  };
});

const perMask = Array.from({ length: FULL_MASK }, (_, index) => index + 1).map((mask) => {
  const summary = summarizeMasks([mask]);
  return {
    mask,
    verifierSize: popcount(mask),
    btsSafetyConstrainedVacAuc: summary.gates["bundle-then-subset"].meanSafetyConstrainedVacAuc,
    btsViolationExposureAuc: summary.gates["bundle-then-subset"].meanViolationExposureAuc,
    bundleFalseAcceptanceRate: summary.bundleVerifierConfusion.falseAcceptanceRate,
  };
});
const worstCaseMasks = {
  highestBtsViolationExposure: [...perMask].sort((left, right) =>
    right.btsViolationExposureAuc - left.btsViolationExposureAuc || left.mask - right.mask)[0],
  lowestBtsSafetyConstrainedVac: [...perMask].sort((left, right) =>
    left.btsSafetyConstrainedVacAuc - right.btsSafetyConstrainedVacAuc || left.mask - right.mask)[0],
  highestBundleFalseAcceptanceRate: [...perMask].sort((left, right) =>
    right.bundleFalseAcceptanceRate - left.bundleFalseAcceptanceRate || left.mask - right.mask)[0],
};

const full = byVerifierSize.find((item) => item.verifierSize === 8);
for (const gate of GATES) {
  const expected = v03Summary.byGate.find((item) => item.gate === gate);
  const observed = full.gates[gate];
  if (
    !nearlyEqual(observed.meanRawVacAuc, expected.meanRawVacAuc) ||
    !nearlyEqual(observed.meanSafetyConstrainedVacAuc, expected.meanSafetyConstrainedVacAuc) ||
    !nearlyEqual(observed.meanViolationExposureAuc, expected.meanViolationExposureAuc)
  ) throw new Error(`Full-verifier aggregate failed to reproduce v0.3 ${gate}.`);
}

const output = {
  schemaVersion: 1,
  scientificStatus: "post-hoc-exhaustive-verifier-subset-stress-test",
  benchmarkId: runSet.benchmarkId,
  frozenRunSetPath: RUN_SET_PATH,
  protocolPath: "research/robustness_v04_stress_protocol.md",
  modelCalls: 0,
  providerCostUsd: 0,
  unitCount: runSet.runIds.length,
  generatedCandidateUnits,
  uniqueCandidateHashes: uniqueCandidateHashes.size,
  candidateRuleCountRange: [minimumCandidateRules, maximumCandidateRules],
  developmentCaseLabels: DEVELOPMENT_CASE_LABELS,
  semanticStrata: SEMANTIC_STRATA,
  intervention: {
    developmentCaseCount: 8,
    nonemptyVerifierMasks: FULL_MASK,
    masksExhaustiveWithinEachSize: true,
    hiddenPerformanceUsedToSelectMasks: false,
  },
  validation: {
    fullVerifierUnitMismatches,
    fullVerifierAggregateReproducesV03: true,
    hiddenTaskLevelArtifactsPersisted: false,
  },
  byVerifierSize,
  bySemanticStratumCount,
  policyEdgeFactorial: {
    fixedBaseCases: ["D1", "D2", "D3", "D4", "D5"],
    variedPolicyEdgeCases: ["D6", "D7", "D8"],
    byRetainedPolicyEdgeCount,
  },
  leaveOneDevelopmentCaseOut: leaveOneOut,
  worstCaseMasks,
  confusionDefinition: "Positive means hidden-safe/useful. False acceptance is an observed hidden-unsafe/useless candidate accepted by the verifier.",
  interpretationGuardrail: "Descriptive sensitivity of one synthetic verifier; not a production-safety or population-level coverage estimate.",
};
await writeFile(path.join(workspaceRoot, OUTPUT_PATH), `${JSON.stringify(output, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({
  outputPath: path.join(workspaceRoot, OUTPUT_PATH),
  scientificStatus: output.scientificStatus,
  modelCalls: 0,
  providerCostUsd: 0,
  fullVerifierUnitMismatches,
  fullVerifierConfusion: full.bundleVerifierConfusion,
  sizeOneConfusion: byVerifierSize[0].bundleVerifierConfusion,
}, null, 2)}\n`);
