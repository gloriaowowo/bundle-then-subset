import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { gradeTrace } from "../dist/eval/grader.js";
import { hashArtifact } from "../dist/eval/manifest.js";
import { fallbackAbstentionWorkflow } from "../dist/methods/artifacts.js";
import { executeWorkflow } from "../dist/simulator/workflow.js";
import { createOrganizations } from "../experiments/v03/benchmark.mjs";
import { applyReleaseGate, RELEASE_GATES } from "../experiments/v03/gates.mjs";
import { currentCoreHashes, fileSha256 } from "../experiments/v03/integrity.mjs";
import { evaluateWorkflowAggregate } from "../experiments/v03/outcomes.mjs";

const RUN_SET_PATH = "research/robustness_v03_deepseek-deepseek-v4-pro_hidden_run_set.json";
const FREEZE_PATH = "research/robustness_v03_protocol_freeze.json";
const PROTOCOL_PATH = "research/robustness_v04_retention_protocol.md";
const SCRIPT_PATH = "scripts/posthoc-retention-v04.mjs";
const OUTPUT_PATH = "research/robustness_v04_retention_summary.json";
const EXPECTED_CHECKPOINTS = [0, 8, 16, 24, 32];
const BOOTSTRAP_REPLICATES = 10_000;
const BOOTSTRAP_SEED = 20_260_825;
const METRIC_FAMILIES = ["raw", "deployable"];
const TRANSITION_WINDOWS = ["allTransitions", "postInitialTransitions"];
const RATE_NAMES = ["retentionRate", "acquisitionRate"];

const workspaceRoot = process.cwd();
const absolute = (relativePath) => path.join(workspaceRoot, relativePath);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const safeRunId = (runId) => /^[a-zA-Z0-9._-]+$/.test(runId);

function nearlyEqual(left, right, tolerance = 1e-12) {
  return Math.abs(left - right) <= tolerance;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function quantile(sorted, probability) {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function makeBootstrapPlan(clusterCount) {
  const random = mulberry32(BOOTSTRAP_SEED);
  return Array.from({ length: BOOTSTRAP_REPLICATES }, () =>
    Array.from({ length: clusterCount }, () => Math.floor(random() * clusterCount)));
}

function summarizeClusterValues(records, key, bootstrapPlan) {
  const selected = records.filter((record) => record[key] !== null);
  if (selected.length !== records.length) {
    throw new Error(`${key} is undefined for one or more organization clusters.`);
  }
  const values = selected.map((record) => record[key]);
  const resampled = bootstrapPlan.map((indices) => mean(indices.map((index) => values[index]))).sort((a, b) => a - b);
  return {
    estimate: mean(values),
    organizationClusterBootstrap95: [quantile(resampled, 0.025), quantile(resampled, 0.975)],
    organizationCount: values.length,
    bootstrapReplicates: BOOTSTRAP_REPLICATES,
    bootstrapSeed: BOOTSTRAP_SEED,
  };
}

function emptyBehaviorCounts() {
  return {
    priorSuccessExposures: 0,
    retainedSuccessExposures: 0,
    priorFailureExposures: 0,
    acquiredSuccessExposures: 0,
  };
}

function addCounts(target, source) {
  for (const key of Object.keys(target)) target[key] += source[key];
}

function ratesFromCounts(counts) {
  return {
    ...counts,
    retentionRate: counts.priorSuccessExposures === 0
      ? null
      : counts.retainedSuccessExposures / counts.priorSuccessExposures,
    acquisitionRate: counts.priorFailureExposures === 0
      ? null
      : counts.acquiredSuccessExposures / counts.priorFailureExposures,
  };
}

function transitionCounts(previous, current) {
  if (previous.length !== current.length) throw new Error("Behavior-vector length changed within a series.");
  const counts = emptyBehaviorCounts();
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index]) {
      counts.priorSuccessExposures += 1;
      if (current[index]) counts.retainedSuccessExposures += 1;
    } else {
      counts.priorFailureExposures += 1;
      if (current[index]) counts.acquiredSuccessExposures += 1;
    }
  }
  return counts;
}

function emptyTransitionDiagnostics() {
  return {
    transitions: 0,
    bothInactive: 0,
    newlyActive: 0,
    retiredToAbstention: 0,
    activeToActive: 0,
    activeToActiveHashChanged: 0,
    activeToActiveHashUnchanged: 0,
    hiddenDeployableUsefulRegressions: 0,
  };
}

function updateTransitionDiagnostics(target, previous, current) {
  target.transitions += 1;
  if (!previous.active && !current.active) target.bothInactive += 1;
  else if (!previous.active && current.active) target.newlyActive += 1;
  else if (previous.active && !current.active) target.retiredToAbstention += 1;
  else {
    target.activeToActive += 1;
    if (previous.activeWorkflowHash === current.activeWorkflowHash) {
      target.activeToActiveHashUnchanged += 1;
    } else {
      target.activeToActiveHashChanged += 1;
    }
  }
  if (previous.hiddenDeployableUseful && !current.hiddenDeployableUseful) {
    target.hiddenDeployableUsefulRegressions += 1;
  }
}

function gatePoint(candidate, activeWorkflow, organization, visibleEvidence, gate) {
  const evidenceIds = new Set(visibleEvidence.map((item) => item.id));
  const caseResults = organization.hiddenTasks.map((task) => {
    const workflow = activeWorkflow ?? fallbackAbstentionWorkflow(task, visibleEvidence, `v04-retention-${gate}`);
    const execution = executeWorkflow(workflow, task, organization.tools);
    return gradeTrace(task, execution.trace, execution.finalState, workflow, evidenceIds);
  });
  const raw = caseResults.map((result) => result.automatedPass);
  const hiddenDeployable = caseResults.every((result) => result.policyPass && result.groundingPass);
  return {
    active: activeWorkflow !== undefined,
    activeWorkflowHash: activeWorkflow ? hashArtifact(activeWorkflow) : null,
    hiddenDeployableUseful: activeWorkflow !== undefined && hiddenDeployable && raw.some(Boolean),
    raw,
    deployable: raw.map((success) => success && hiddenDeployable),
  };
}

function comparisonShape(storedEvaluation) {
  const { gate: _gate, verifier: _verifier, promotion: _promotion, ...metrics } = storedEvaluation;
  return metrics;
}

function replayPromotionShape(decision) {
  const { activeWorkflow, ...withoutWorkflow } = decision;
  const activeWorkflowHash = activeWorkflow ? hashArtifact(activeWorkflow) : undefined;
  return {
    ...withoutWorkflow,
    ...(activeWorkflowHash ? { activeWorkflowHash } : {}),
  };
}

function seriesKey(aggregate) {
  return [aggregate.organizationId, aggregate.evidenceRegime, aggregate.trialSeed].join(":");
}

const [freeze, runSet] = await Promise.all([
  readFile(absolute(FREEZE_PATH), "utf8").then(JSON.parse),
  readFile(absolute(RUN_SET_PATH), "utf8").then(JSON.parse),
]);
const currentHashes = await currentCoreHashes(workspaceRoot);
const frozenHashMatches = Object.fromEntries(Object.entries(freeze.hashes).map(([name, expected]) => [
  name,
  currentHashes[name] === expected,
]));
if (Object.values(frozenHashMatches).some((matches) => !matches)) {
  throw new Error("A frozen v0.3 input changed before the v0.4 retention replay.");
}
if (
  runSet.benchmarkId !== freeze.benchmark.id ||
  runSet.evaluationSplit !== "hidden" ||
  runSet.runIds.length !== 480 ||
  JSON.stringify(runSet.checkpoints) !== JSON.stringify(EXPECTED_CHECKPOINTS)
) throw new Error("The v0.3 hidden run-set contract does not match the v0.4 retention protocol.");

const organizationsByRegime = new Map(runSet.evidenceRegimes.map((regime) => [
  regime,
  new Map(createOrganizations(regime).map((organization) => [organization.id, organization])),
]));
const pointSeries = new Map();
const uniqueUnitKeys = new Set();
let manifestsValidated = 0;
let artifactsValidated = 0;
let candidatesValidated = 0;
let fullVerifierGateUnitComparisons = 0;
let fullVerifierDecisionMismatches = 0;
let fullVerifierHiddenAggregateMismatches = 0;

for (const runId of runSet.runIds) {
  if (!safeRunId(runId)) throw new Error(`Unsafe run ID ${runId}.`);
  const runDirectory = path.join(workspaceRoot, "runs", runId);
  const [manifest, aggregate, artifacts] = await Promise.all([
    readFile(path.join(runDirectory, "manifest.json"), "utf8").then(JSON.parse),
    readFile(path.join(runDirectory, "aggregate.json"), "utf8").then(JSON.parse),
    readFile(path.join(runDirectory, "artifacts.json"), "utf8").then(JSON.parse),
  ]);
  if (
    aggregate.benchmarkId !== freeze.benchmark.id ||
    aggregate.evaluationSplit !== "hidden" ||
    aggregate.runStatus !== "valid" ||
    manifest.benchmarkId !== freeze.benchmark.id ||
    manifest.hashes.v03Implementation !== freeze.hashes.v03ImplementationAllMjs ||
    manifest.hashes.importedRuntime !== freeze.hashes.importedRuntimeAllDistJs ||
    manifest.hashes.benchmark !== freeze.hashes.benchmarkAllRegimes ||
    manifest.hashes.promptContract !== freeze.hashes.promptContract ||
    manifest.hashes.aggregate !== hashArtifact(aggregate)
  ) throw new Error(`Frozen manifest or aggregate mismatch in ${runId}.`);
  manifestsValidated += 1;
  if (manifest.hashes.artifacts !== hashArtifact(artifacts)) {
    throw new Error(`Frozen artifact mismatch in ${runId}.`);
  }
  artifactsValidated += 1;
  const candidate = artifacts.candidate ?? undefined;
  if ((candidate ? hashArtifact(candidate) : null) !== aggregate.candidateHash) {
    throw new Error(`Candidate hash mismatch in ${runId}.`);
  }
  candidatesValidated += 1;

  const unitKey = [
    manifest.model.provider,
    manifest.model.id,
    aggregate.organizationId,
    aggregate.evidenceRegime,
    aggregate.checkpoint,
    aggregate.trialSeed,
  ].join(":");
  if (uniqueUnitKeys.has(unitKey)) throw new Error(`Duplicate frozen unit ${unitKey}.`);
  uniqueUnitKeys.add(unitKey);

  const organization = organizationsByRegime.get(aggregate.evidenceRegime)?.get(aggregate.organizationId);
  if (!organization) throw new Error(`Missing frozen organization ${aggregate.organizationId}.`);
  const visibleEvidence = organization.evidence.slice(0, aggregate.checkpoint);
  const evidenceIds = new Set(visibleEvidence.map((item) => item.id));
  const storedByGate = new Map(aggregate.gateEvaluations.map((evaluation) => [evaluation.gate, evaluation]));
  if (storedByGate.size !== RELEASE_GATES.length) throw new Error(`Gate count mismatch in ${runId}.`);

  const gatePoints = {};
  for (const gate of RELEASE_GATES) {
    const stored = storedByGate.get(gate);
    if (!stored || stored.verifier?.strategy !== "full" || stored.verifier?.size !== 8) {
      throw new Error(`Missing full-verifier ${gate} evaluation in ${runId}.`);
    }
    const decision = applyReleaseGate(
      candidate,
      gate,
      organization.developmentTasks,
      organization.tools,
      evidenceIds,
    );
    const replayedPromotion = replayPromotionShape(decision);
    try {
      assert.deepStrictEqual(replayedPromotion, stored.promotion);
    } catch (error) {
      fullVerifierDecisionMismatches += 1;
      throw new Error(`Full-verifier decision replay mismatch for ${gate} in ${runId}: ${error.message}`);
    }
    const replayedAggregate = evaluateWorkflowAggregate({
      candidate,
      activeWorkflow: decision.activeWorkflow,
      tasks: organization.hiddenTasks,
      visibleEvidence,
      tools: organization.tools,
      idSuffix: `v04-retention-replay-${gate}`,
    });
    try {
      assert.deepStrictEqual(replayedAggregate, comparisonShape(stored));
    } catch (error) {
      fullVerifierHiddenAggregateMismatches += 1;
      throw new Error(`Hidden aggregate replay mismatch for ${gate} in ${runId}: ${error.message}`);
    }
    fullVerifierGateUnitComparisons += 1;
    gatePoints[gate] = gatePoint(candidate, decision.activeWorkflow, organization, visibleEvidence, gate);
  }

  const key = seriesKey(aggregate);
  const points = pointSeries.get(key) ?? [];
  points.push({
    organizationId: aggregate.organizationId,
    evidenceRegime: aggregate.evidenceRegime,
    trialSeed: aggregate.trialSeed,
    checkpoint: aggregate.checkpoint,
    gatePoints,
  });
  pointSeries.set(key, points);
}

const expectedUnitCount = runSet.organizations.length * runSet.evidenceRegimes.length *
  runSet.checkpoints.length * runSet.trialSeeds.length * runSet.models.length;
if (uniqueUnitKeys.size !== expectedUnitCount || expectedUnitCount !== 480) {
  throw new Error(`Expected 480 unique frozen units, found ${uniqueUnitKeys.size}.`);
}
const expectedSeriesCount = runSet.organizations.length * runSet.evidenceRegimes.length *
  runSet.trialSeeds.length * runSet.models.length;
if (pointSeries.size !== expectedSeriesCount || expectedSeriesCount !== 96) {
  throw new Error(`Expected 96 complete acquisition series, found ${pointSeries.size}.`);
}

const organizationAccumulator = new Map(runSet.organizations.map((organizationId) => [
  organizationId,
  Object.fromEntries(RELEASE_GATES.map((gate) => [gate, {
    transitionCount: 0,
    casePairExposures: 0,
    diagnostics: emptyTransitionDiagnostics(),
    raw: Object.fromEntries(TRANSITION_WINDOWS.map((window) => [window, emptyBehaviorCounts()])),
    deployable: Object.fromEntries(TRANSITION_WINDOWS.map((window) => [window, emptyBehaviorCounts()])),
  }])),
]));

for (const points of pointSeries.values()) {
  points.sort((left, right) => left.checkpoint - right.checkpoint);
  if (JSON.stringify(points.map((point) => point.checkpoint)) !== JSON.stringify(EXPECTED_CHECKPOINTS)) {
    throw new Error("An acquisition series is missing a frozen checkpoint.");
  }
  for (const gate of RELEASE_GATES) {
    const organizationGate = organizationAccumulator.get(points[0].organizationId)[gate];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1].gatePoints[gate];
      const current = points[index].gatePoints[gate];
      organizationGate.transitionCount += 1;
      organizationGate.casePairExposures += previous.raw.length;
      updateTransitionDiagnostics(organizationGate.diagnostics, previous, current);
      for (const family of METRIC_FAMILIES) {
        const counts = transitionCounts(previous[family], current[family]);
        addCounts(organizationGate[family].allTransitions, counts);
        if (index > 1) addCounts(organizationGate[family].postInitialTransitions, counts);
      }
    }
  }
}

const bootstrapPlan = makeBootstrapPlan(runSet.organizations.length);
const byGate = {};
for (const gate of RELEASE_GATES) {
  const perOrganization = runSet.organizations.map((organizationId) => {
    const accumulated = organizationAccumulator.get(organizationId)[gate];
    return {
      organizationId,
      transitionCount: accumulated.transitionCount,
      casePairExposures: accumulated.casePairExposures,
      transitionDiagnostics: accumulated.diagnostics,
      ...Object.fromEntries(METRIC_FAMILIES.map((family) => [family,
        Object.fromEntries(TRANSITION_WINDOWS.map((window) => [
          window,
          ratesFromCounts(accumulated[family][window]),
        ])),
      ])),
    };
  });
  const microDiagnostics = emptyTransitionDiagnostics();
  for (const record of perOrganization) {
    for (const key of Object.keys(microDiagnostics)) {
      microDiagnostics[key] += record.transitionDiagnostics[key];
    }
  }
  byGate[gate] = {
    organizationCount: perOrganization.length,
    seriesCount: expectedSeriesCount,
    transitionCount: perOrganization.reduce((sum, record) => sum + record.transitionCount, 0),
    casePairExposures: perOrganization.reduce((sum, record) => sum + record.casePairExposures, 0),
    transitionDiagnostics: microDiagnostics,
    behavior: Object.fromEntries(METRIC_FAMILIES.map((family) => [family,
      Object.fromEntries(TRANSITION_WINDOWS.map((window) => {
        const flattened = perOrganization.map((record) => ({
          organizationId: record.organizationId,
          ...record[family][window],
        }));
        const microCounts = emptyBehaviorCounts();
        for (const record of flattened) addCounts(microCounts, record);
        return [window, {
          organizationCluster: Object.fromEntries(RATE_NAMES.map((rate) => [
            rate,
            summarizeClusterValues(flattened, rate, bootstrapPlan),
          ])),
          microAggregate: ratesFromCounts(microCounts),
          perOrganization: flattened,
        }];
      })),
    ])),
    perOrganizationTransitionDiagnostics: perOrganization.map((record) => ({
      organizationId: record.organizationId,
      ...record.transitionDiagnostics,
    })),
  };
}

function pairedDifference(treatmentGate, baselineGate, family, window, rate) {
  const treatment = byGate[treatmentGate].behavior[family][window].perOrganization;
  const baseline = new Map(byGate[baselineGate].behavior[family][window].perOrganization.map((record) => [
    record.organizationId,
    record,
  ]));
  const records = treatment.map((record) => {
    const paired = baseline.get(record.organizationId);
    if (!paired || record[rate] === null || paired[rate] === null) {
      throw new Error(`Undefined paired ${rate} for ${record.organizationId}.`);
    }
    return { organizationId: record.organizationId, difference: record[rate] - paired[rate] };
  });
  return {
    ...summarizeClusterValues(records, "difference", bootstrapPlan),
    perOrganization: records,
  };
}

const pairedGateDifferences = {};
for (const baseline of ["bundle", "direct", "safe-subset"]) {
  const label = `bundle-then-subset-minus-${baseline}`;
  pairedGateDifferences[label] = Object.fromEntries(METRIC_FAMILIES.map((family) => [family,
    Object.fromEntries(TRANSITION_WINDOWS.map((window) => [window,
      Object.fromEntries(RATE_NAMES.map((rate) => [
        rate,
        pairedDifference("bundle-then-subset", baseline, family, window, rate),
      ])),
    ])),
  ]));
}

const output = {
  schemaVersion: 1,
  scientificStatus: "post-hoc-v04-checkpoint-behavior-retention",
  benchmarkId: runSet.benchmarkId,
  frozenRunSetPath: RUN_SET_PATH,
  protocolPath: PROTOCOL_PATH,
  scope: "Successive released snapshots under cumulative evidence replay; not stateful online optimization.",
  modelCalls: 0,
  providerCostUsd: 0,
  independentOrganizationClusters: runSet.organizations.length,
  seriesCount: expectedSeriesCount,
  transitionCount: expectedSeriesCount * (EXPECTED_CHECKPOINTS.length - 1),
  checkpoints: EXPECTED_CHECKPOINTS,
  definitions: {
    rawSuccess: "Per-case simultaneous functional, policy, and grounding pass (frozen automatedPass).",
    deployableSuccess: "Raw success while every hidden case for the active artifact passes policy and grounding.",
    retention: "Prior successes that remain successes divided by prior successes.",
    acquisition: "Prior failures that become successes divided by prior failures.",
    allTransitions: "0->8, 8->16, 16->24, and 24->32.",
    postInitialTransitions: "8->16, 16->24, and 24->32.",
  },
  validation: {
    expectedFrozenUnits: expectedUnitCount,
    uniqueFrozenUnits: uniqueUnitKeys.size,
    manifestsValidated,
    artifactsValidated,
    candidatesValidated,
    fullVerifierGateUnitComparisons,
    fullVerifierDecisionMismatches,
    fullVerifierHiddenAggregateMismatches,
    fullVerifierReproductionPassed:
      fullVerifierDecisionMismatches === 0 && fullVerifierHiddenAggregateMismatches === 0,
    v03FrozenHashesMatch: frozenHashMatches,
  },
  aggregation: {
    unit: "organization cluster",
    clusterCount: runSet.organizations.length,
    bootstrapReplicates: BOOTSTRAP_REPLICATES,
    bootstrapSeed: BOOTSTRAP_SEED,
    centralEstimate: "Unweighted mean of organization-level rates after within-organization count aggregation.",
  },
  byGate,
  pairedGateDifferences,
  hiddenCaseLevelArtifactsPersisted: false,
  sourceHashes: {
    v03Freeze: await fileSha256(absolute(FREEZE_PATH)),
    v03RunSet: await fileSha256(absolute(RUN_SET_PATH)),
    protocol: await fileSha256(absolute(PROTOCOL_PATH)),
    analysisScript: await fileSha256(absolute(SCRIPT_PATH)),
  },
};

if (!output.validation.fullVerifierReproductionPassed) {
  throw new Error("Frozen full-verifier outputs did not reproduce; refusing to persist v0.4 retention results.");
}
await writeFile(absolute(OUTPUT_PATH), `${JSON.stringify(output, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({
  outputPath: absolute(OUTPUT_PATH),
  scientificStatus: output.scientificStatus,
  modelCalls: output.modelCalls,
  uniqueFrozenUnits: output.validation.uniqueFrozenUnits,
  fullVerifierGateUnitComparisons: output.validation.fullVerifierGateUnitComparisons,
  fullVerifierReproductionPassed: output.validation.fullVerifierReproductionPassed,
  byGate: Object.fromEntries(RELEASE_GATES.map((gate) => [gate, {
    raw: output.byGate[gate].behavior.raw.allTransitions.organizationCluster,
    deployable: output.byGate[gate].behavior.deployable.allTransitions.organizationCluster,
  }])),
}, null, 2)}\n`);
