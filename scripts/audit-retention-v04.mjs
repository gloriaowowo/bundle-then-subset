import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { RELEASE_GATES } from "../experiments/v03/gates.mjs";
import { currentCoreHashes } from "../experiments/v03/integrity.mjs";

const paths = {
  v03Freeze: "research/robustness_v03_protocol_freeze.json",
  v03RunSet: "research/robustness_v03_deepseek-deepseek-v4-pro_hidden_run_set.json",
  protocol: "research/robustness_v04_retention_protocol.md",
  analysisScript: "scripts/posthoc-retention-v04.mjs",
  summary: "research/robustness_v04_retention_summary.json",
  auditScript: "scripts/audit-retention-v04.mjs",
  auditOutput: "research/robustness_v04_retention_audit.json",
};
const METRIC_FAMILIES = ["raw", "deployable"];
const TRANSITION_WINDOWS = ["allTransitions", "postInitialTransitions"];
const RATE_NAMES = ["retentionRate", "acquisitionRate"];
const workspaceRoot = process.cwd();
const absolute = (relativePath) => path.join(workspaceRoot, relativePath);
const sha256 = async (relativePath) => createHash("sha256")
  .update(await readFile(absolute(relativePath)))
  .digest("hex");
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const nearlyEqual = (left, right, tolerance = 1e-12) => Math.abs(left - right) <= tolerance;

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function validateRateRecord(record, location) {
  const keys = [
    "priorSuccessExposures",
    "retainedSuccessExposures",
    "priorFailureExposures",
    "acquiredSuccessExposures",
  ];
  for (const key of keys) {
    assertCondition(Number.isInteger(record[key]) && record[key] >= 0, `${location}.${key} is invalid.`);
  }
  assertCondition(
    record.retainedSuccessExposures <= record.priorSuccessExposures,
    `${location} retains more successes than existed.`,
  );
  assertCondition(
    record.acquiredSuccessExposures <= record.priorFailureExposures,
    `${location} acquires more successes than prior failures.`,
  );
  const expectedRetention = record.priorSuccessExposures === 0
    ? null
    : record.retainedSuccessExposures / record.priorSuccessExposures;
  const expectedAcquisition = record.priorFailureExposures === 0
    ? null
    : record.acquiredSuccessExposures / record.priorFailureExposures;
  assertCondition(
    expectedRetention === null
      ? record.retentionRate === null
      : nearlyEqual(record.retentionRate, expectedRetention),
    `${location}.retentionRate does not reproduce its aggregate counts.`,
  );
  assertCondition(
    expectedAcquisition === null
      ? record.acquisitionRate === null
      : nearlyEqual(record.acquisitionRate, expectedAcquisition),
    `${location}.acquisitionRate does not reproduce its aggregate counts.`,
  );
}

function addCountRecords(records) {
  return records.reduce((totals, record) => {
    totals.priorSuccessExposures += record.priorSuccessExposures;
    totals.retainedSuccessExposures += record.retainedSuccessExposures;
    totals.priorFailureExposures += record.priorFailureExposures;
    totals.acquiredSuccessExposures += record.acquiredSuccessExposures;
    return totals;
  }, {
    priorSuccessExposures: 0,
    retainedSuccessExposures: 0,
    priorFailureExposures: 0,
    acquiredSuccessExposures: 0,
  });
}

function inspectForbiddenKeys(value, location, findings) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectForbiddenKeys(item, `${location}[${index}]`, findings));
    return;
  }
  const forbidden = new Set([
    "task", "tasks", "taskId", "taskIds", "trace", "traces", "grade", "grades",
    "failureString", "failureStrings", "caseId", "caseIds", "successVector", "successVectors",
  ]);
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.has(key)) findings.push(`${location}.${key}`);
    inspectForbiddenKeys(item, `${location}.${key}`, findings);
  }
}

const [freeze, runSet, summary] = await Promise.all([
  readFile(absolute(paths.v03Freeze), "utf8").then(JSON.parse),
  readFile(absolute(paths.v03RunSet), "utf8").then(JSON.parse),
  readFile(absolute(paths.summary), "utf8").then(JSON.parse),
]);
const currentV03 = await currentCoreHashes(workspaceRoot);
const v03FrozenHashesMatch = Object.fromEntries(Object.entries(freeze.hashes).map(([name, expected]) => [
  name,
  currentV03[name] === expected,
]));
assertCondition(
  Object.values(v03FrozenHashesMatch).every(Boolean),
  "A frozen v0.3 input changed before the v0.4 retention audit.",
);
const actualSourceHashes = {
  v03Freeze: await sha256(paths.v03Freeze),
  v03RunSet: await sha256(paths.v03RunSet),
  protocol: await sha256(paths.protocol),
  analysisScript: await sha256(paths.analysisScript),
};
assertCondition(
  JSON.stringify(actualSourceHashes) === JSON.stringify(summary.sourceHashes),
  "The v0.4 retention source hashes do not match the generated summary.",
);
assertCondition(
  summary.scientificStatus === "post-hoc-v04-checkpoint-behavior-retention" &&
  summary.benchmarkId === freeze.benchmark.id &&
  summary.modelCalls === 0 && summary.providerCostUsd === 0,
  "The v0.4 retention summary status, benchmark, or zero-call contract is invalid.",
);
assertCondition(
  runSet.runIds.length === 480 && summary.validation.expectedFrozenUnits === 480 &&
  summary.validation.uniqueFrozenUnits === 480 && summary.validation.manifestsValidated === 480 &&
  summary.validation.artifactsValidated === 480 && summary.validation.candidatesValidated === 480,
  "The v0.4 retention frozen-unit validation counts are invalid.",
);
assertCondition(
  summary.validation.fullVerifierGateUnitComparisons === 1_920 &&
  summary.validation.fullVerifierDecisionMismatches === 0 &&
  summary.validation.fullVerifierHiddenAggregateMismatches === 0 &&
  summary.validation.fullVerifierReproductionPassed,
  "The v0.4 retention full-verifier replay contract failed.",
);
assertCondition(
  summary.independentOrganizationClusters === 8 && summary.seriesCount === 96 &&
  summary.transitionCount === 384,
  "The v0.4 retention cluster, series, or transition count is invalid.",
);

for (const gate of RELEASE_GATES) {
  const gateSummary = summary.byGate[gate];
  assertCondition(Boolean(gateSummary), `Missing gate summary ${gate}.`);
  assertCondition(
    gateSummary.organizationCount === 8 && gateSummary.seriesCount === 96 &&
    gateSummary.transitionCount === 384 && gateSummary.casePairExposures === 4_800,
    `${gate} has invalid aggregate dimensions.`,
  );
  const diagnostics = gateSummary.transitionDiagnostics;
  assertCondition(
    diagnostics.bothInactive + diagnostics.newlyActive + diagnostics.retiredToAbstention +
      diagnostics.activeToActive === diagnostics.transitions && diagnostics.transitions === 384,
    `${gate} transition diagnostics are not exhaustive.`,
  );
  assertCondition(
    diagnostics.activeToActiveHashChanged + diagnostics.activeToActiveHashUnchanged ===
      diagnostics.activeToActive,
    `${gate} active-workflow hash diagnostics are not exhaustive.`,
  );
  for (const family of METRIC_FAMILIES) {
    for (const window of TRANSITION_WINDOWS) {
      const result = gateSummary.behavior[family][window];
      assertCondition(result.perOrganization.length === 8, `${gate}.${family}.${window} lacks eight clusters.`);
      assertCondition(
        new Set(result.perOrganization.map((record) => record.organizationId)).size === 8,
        `${gate}.${family}.${window} has duplicate organization clusters.`,
      );
      for (const record of result.perOrganization) {
        validateRateRecord(record, `${gate}.${family}.${window}.${record.organizationId}`);
      }
      validateRateRecord(result.microAggregate, `${gate}.${family}.${window}.microAggregate`);
      const summed = addCountRecords(result.perOrganization);
      for (const [key, value] of Object.entries(summed)) {
        assertCondition(
          result.microAggregate[key] === value,
          `${gate}.${family}.${window}.microAggregate.${key} does not equal its clusters.`,
        );
      }
      for (const rate of RATE_NAMES) {
        const clusterResult = result.organizationCluster[rate];
        const expected = mean(result.perOrganization.map((record) => record[rate]));
        assertCondition(
          clusterResult.organizationCount === 8 && clusterResult.bootstrapReplicates === 10_000 &&
          clusterResult.bootstrapSeed === 20_260_825 && nearlyEqual(clusterResult.estimate, expected),
          `${gate}.${family}.${window}.${rate} cluster aggregation is invalid.`,
        );
      }
    }
  }
}

for (const baseline of ["bundle", "direct", "safe-subset"]) {
  const label = `bundle-then-subset-minus-${baseline}`;
  const comparison = summary.pairedGateDifferences[label];
  assertCondition(Boolean(comparison), `Missing paired gate comparison ${label}.`);
  for (const family of METRIC_FAMILIES) {
    for (const window of TRANSITION_WINDOWS) {
      const treatmentRecords = new Map(
        summary.byGate["bundle-then-subset"].behavior[family][window].perOrganization.map((record) => [
          record.organizationId,
          record,
        ]),
      );
      const baselineRecords = new Map(
        summary.byGate[baseline].behavior[family][window].perOrganization.map((record) => [
          record.organizationId,
          record,
        ]),
      );
      for (const rate of RATE_NAMES) {
        const result = comparison[family][window][rate];
        assertCondition(result.perOrganization.length === 8, `${label}.${family}.${window}.${rate} is incomplete.`);
        for (const record of result.perOrganization) {
          const expected = treatmentRecords.get(record.organizationId)[rate] - baselineRecords.get(record.organizationId)[rate];
          assertCondition(
            nearlyEqual(record.difference, expected),
            `${label}.${family}.${window}.${rate}.${record.organizationId} is not paired correctly.`,
          );
        }
        assertCondition(
          nearlyEqual(result.estimate, mean(result.perOrganization.map((record) => record.difference))),
          `${label}.${family}.${window}.${rate} estimate is not the cluster mean.`,
        );
      }
    }
  }
}

const forbiddenLocations = [];
inspectForbiddenKeys(summary, "summary", forbiddenLocations);
assertCondition(
  forbiddenLocations.length === 0 && summary.hiddenCaseLevelArtifactsPersisted === false,
  `Task-level hidden artifacts were persisted: ${forbiddenLocations.slice(0, 5).join(", ")}`,
);

const audit = {
  schemaVersion: 1,
  scientificStatus: "post-hoc-v04-retention-audited",
  benchmarkId: summary.benchmarkId,
  v03FrozenHashesMatch,
  uniqueFrozenUnits: summary.validation.uniqueFrozenUnits,
  fullVerifierGateUnitComparisons: summary.validation.fullVerifierGateUnitComparisons,
  fullVerifierDecisionMismatches: summary.validation.fullVerifierDecisionMismatches,
  fullVerifierHiddenAggregateMismatches: summary.validation.fullVerifierHiddenAggregateMismatches,
  organizationClusters: summary.independentOrganizationClusters,
  acquisitionSeries: summary.seriesCount,
  adjacentCheckpointTransitions: summary.transitionCount,
  aggregateDimensionsValid: true,
  organizationClusterAggregationValid: true,
  pairedGateDifferencesValid: true,
  modelCalls: 0,
  providerCostUsd: 0,
  hiddenCaseLevelArtifactsPersisted: false,
  hashes: {
    ...actualSourceHashes,
    summary: await sha256(paths.summary),
    auditScript: await sha256(paths.auditScript),
  },
};
await writeFile(absolute(paths.auditOutput), `${JSON.stringify(audit, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ...audit, outputPath: absolute(paths.auditOutput) }, null, 2)}\n`);
