#!/usr/bin/env node
// POST-HOC analysis, added for the camera-ready in response to reviews (CLEA #74:
// per-mask distribution of the v0.4 verifier-subset replay). ZERO MODEL CALLS:
// stored v0.3 DeepSeek candidates are replayed through the frozen deterministic
// gates and hidden evaluator under all 255 nonempty subsets of the eight
// development cases, exactly as scripts/posthoc-verifier-ablation-v04.mjs does.
// That script reports pooled means; this one keeps every mask separate and
// counts, per mask, whether BTS's mean violation-exposure AUC is lower than,
// equal to, or higher than Safe-Subset's (and Bundle's). It also counts
// safe-coverage (SC-AUC) reversals at the seed-series, organization and
// unit-checkpoint levels, so the "BTS never costs safe coverage" statement can
// be scoped to the level at which it holds.
//
// Ported from the camera-ready analysis workspace (permask-v04.mjs replay +
// a_mask_wtl.py win/tie/loss tabulation). Requires `npm run build` (dist/).
//
// Outputs:
//   research/robustness_v04_mask_distribution.json
//   research/robustness_v04_mask_distribution_per_mask.csv
//
// Self-checks (throws on failure): the full eight-case mask reproduces every
// stored v0.3 gate decision hash and metric, and pooled per-size,
// per-semantic-stratum-count and leave-one-out means reproduce the committed
// research/robustness_v04_verifier_ablation.json.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { hashArtifact } from "../dist/eval/manifest.js";
import { applyPromotionGate } from "../dist/methods/promotion.js";
import { createOrganizations } from "../experiments/v03/benchmark.mjs";
import { evaluateWorkflowAggregate } from "../experiments/v03/outcomes.mjs";

const RUN_SET_PATH = "research/robustness_v03_deepseek-deepseek-v4-pro_hidden_run_set.json";
const ABLATION_PATH = "research/robustness_v04_verifier_ablation.json";
const OUTPUT_PATH = "research/robustness_v04_mask_distribution.json";
const CSV_PATH = "research/robustness_v04_mask_distribution_per_mask.csv";
const FULL_MASK = (1 << 8) - 1;
const GATES = ["bundle", "safe-subset", "bundle-then-subset"];
const EPS = 1e-12;
const FRACTIONS = [0, 0.25, 0.5, 0.75, 1];
const D3 = 1 << 2; // special over-threshold approval case
const D8 = 1 << 7; // ineligible special-request escalation case
// Same six semantic strata as the frozen v0.4 ablation (Fig. 1(c) grouping).
const SEMANTIC_STRATA = [
  { id: "S1", caseIndices: [0, 3] },
  { id: "S2", caseIndices: [5] },
  { id: "S3", caseIndices: [1] },
  { id: "S4", caseIndices: [4, 6] },
  { id: "S5", caseIndices: [2] },
  { id: "S6", caseIndices: [7] },
].map((s) => ({ ...s, caseMask: s.caseIndices.reduce((m, i) => m | (1 << i), 0) }));

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const popcount = (value) => {
  let count = 0;
  for (let current = value; current > 0; current >>>= 1) count += current & 1;
  return count;
};
const caseSet = (mask) => Array.from({ length: 8 }, (_, i) => i).filter((i) => mask & (1 << i)).map((i) => `D${i + 1}`).join("+");
const cls = (delta) => (delta < -EPS ? "lower" : delta > EPS ? "higher" : "equal");
const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;

function trapezoid(byFraction) {
  let area = 0;
  for (let i = 1; i < FRACTIONS.length; i += 1) {
    const a = byFraction.get(FRACTIONS[i - 1]);
    const b = byFraction.get(FRACTIONS[i]);
    if (a === undefined || b === undefined) throw new Error("Incomplete acquisition curve.");
    area += (FRACTIONS[i] - FRACTIONS[i - 1]) * (a + b) / 2;
  }
  return area;
}

// Semantic masks: union of retained strata (63 nonempty stratum subsets).
const semanticByCaseMask = new Map();
for (let sm = 1; sm < (1 << SEMANTIC_STRATA.length); sm += 1) {
  const retained = SEMANTIC_STRATA.filter((_, i) => sm & (1 << i));
  const caseMask = retained.reduce((m, s) => m | s.caseMask, 0);
  semanticByCaseMask.set(caseMask, { count: retained.length, ids: retained.map((s) => s.id).join("+") });
}
if (semanticByCaseMask.size !== 63) throw new Error("Expected 63 semantic masks.");

const ROOT = process.cwd();
const readJson = async (file) => JSON.parse(await readFile(path.join(ROOT, file), "utf8"));
const [runSet, ablation] = await Promise.all([readJson(RUN_SET_PATH), readJson(ABLATION_PATH)]);
if (runSet.evaluationSplit !== "hidden" || runSet.runIds.length !== 480) {
  throw new Error("Expected the frozen 480-unit v0.3 hidden run set.");
}
const organizationsByRegime = new Map(runSet.evidenceRegimes.map((regime) => [
  regime,
  new Map(createOrganizations(regime).map((o) => [o.id, o])),
]));

// cells[mask][gate] -> array of {seriesKey, org, fraction, sc, raw, viol}
const cells = Array.from({ length: FULL_MASK + 1 }, () => Object.fromEntries(GATES.map((g) => [g, []])));
let fullVerifierUnitMismatches = 0;

for (let unitIndex = 0; unitIndex < runSet.runIds.length; unitIndex += 1) {
  const runId = runSet.runIds[unitIndex];
  if (!/^[a-zA-Z0-9._-]+$/.test(runId)) throw new Error(`Unsafe run ID ${runId}.`);
  const dir = path.join(ROOT, "runs", runId);
  const [aggregate, artifacts, manifest] = await Promise.all([
    readFile(path.join(dir, "aggregate.json"), "utf8").then(JSON.parse),
    readFile(path.join(dir, "artifacts.json"), "utf8").then(JSON.parse),
    readFile(path.join(dir, "manifest.json"), "utf8").then(JSON.parse),
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
  const organization = organizationsByRegime.get(aggregate.evidenceRegime).get(aggregate.organizationId);
  const visibleEvidence = organization.evidence.slice(0, aggregate.checkpoint);
  const evidenceIds = new Set(visibleEvidence.map((item) => item.id));
  const storedByGate = new Map(aggregate.gateEvaluations.map((item) => [item.gate, item]));
  const seriesKey = `${aggregate.organizationId}:${aggregate.evidenceRegime}:${aggregate.trialSeed}`;

  for (let mask = 1; mask <= FULL_MASK; mask += 1) {
    const developmentTasks = organization.developmentTasks.filter((_, i) => mask & (1 << i));
    const bundleDecision = applyPromotionGate(candidate, "bundle", developmentTasks, organization.tools, evidenceIds);
    const subsetDecision = applyPromotionGate(candidate, "safe-subset", developmentTasks, organization.tools, evidenceIds);
    const activeByGate = {
      bundle: bundleDecision.activeWorkflow,
      "safe-subset": subsetDecision.activeWorkflow,
      "bundle-then-subset": bundleDecision.activeWorkflow ?? subsetDecision.activeWorkflow,
    };
    for (const gate of GATES) {
      const evaluation = evaluateWorkflowAggregate({
        candidate,
        activeWorkflow: activeByGate[gate],
        tasks: organization.hiddenTasks,
        visibleEvidence,
        tools: organization.tools,
        idSuffix: `v04-${mask}-${gate}`,
      });
      const cell = {
        seriesKey,
        org: aggregate.organizationId,
        fraction: aggregate.evidenceFraction,
        sc: evaluation.safetyConstrainedVac,
        raw: evaluation.verifiedAutomationCoverage,
        viol: 1 - evaluation.policyPassRate,
      };
      cells[mask][gate].push(cell);
      if (mask === FULL_MASK) {
        const stored = storedByGate.get(gate);
        const hash = activeByGate[gate] ? hashArtifact(activeByGate[gate]) : undefined;
        if (
          !near(cell.raw, stored.verifiedAutomationCoverage) ||
          !near(cell.sc, stored.safetyConstrainedVac) ||
          !near(cell.viol, 1 - stored.policyPassRate) ||
          hash !== stored.promotion.activeWorkflowHash ||
          JSON.stringify(evaluation.outcomeCounts) !== JSON.stringify(stored.outcomeCounts)
        ) fullVerifierUnitMismatches += 1;
      }
    }
  }
  if ((unitIndex + 1) % 80 === 0) process.stderr.write(`replayed ${unitIndex + 1}/480 units x 255 masks\n`);
}
if (fullVerifierUnitMismatches !== 0) {
  throw new Error(`Full-verifier reconstruction mismatched ${fullVerifierUnitMismatches} gate-unit results.`);
}

// Seed-series AUCs per (mask, gate).
const seriesAuc = Array.from({ length: FULL_MASK + 1 }, () => ({}));
for (let mask = 1; mask <= FULL_MASK; mask += 1) {
  for (const gate of GATES) {
    const bySeries = new Map();
    for (const c of cells[mask][gate]) {
      const s = bySeries.get(c.seriesKey) ?? { org: c.org, sc: new Map(), raw: new Map(), viol: new Map() };
      s.sc.set(c.fraction, c.sc); s.raw.set(c.fraction, c.raw); s.viol.set(c.fraction, c.viol);
      bySeries.set(c.seriesKey, s);
    }
    seriesAuc[mask][gate] = new Map([...bySeries].map(([k, s]) => [k, {
      org: s.org, sc: trapezoid(s.sc), raw: trapezoid(s.raw), viol: trapezoid(s.viol),
    }]));
  }
}

// Per-mask summary rows.
const perMask = [];
for (let mask = 1; mask <= FULL_MASK; mask += 1) {
  const sem = semanticByCaseMask.get(mask);
  const row = {
    mask,
    caseSet: caseSet(mask),
    verifierSize: popcount(mask),
    semanticStratumCount: sem ? sem.count : null,
    semanticStrata: sem ? sem.ids : "",
    d8Present: Boolean(mask & D8),
    d3Present: Boolean(mask & D3),
  };
  const series = seriesAuc[mask];
  const keys = [...series.bundle.keys()];
  if (keys.length !== 96) throw new Error(`Expected 96 seed series for mask ${mask}.`);
  for (const [short, gate] of [["b", "bundle"], ["ss", "safe-subset"], ["bts", "bundle-then-subset"]]) {
    for (const m of ["sc", "viol", "raw"]) row[`${short}_${m}Auc`] = mean(keys.map((k) => series[gate].get(k)[m]));
  }
  for (const m of ["sc", "viol", "raw"]) {
    row[`d_bts_ss_${m}Auc`] = row[`bts_${m}Auc`] - row[`ss_${m}Auc`];
    row[`d_bts_b_${m}Auc`] = row[`bts_${m}Auc`] - row[`b_${m}Auc`];
  }
  row.violClassVsSafeSubset = cls(row.d_bts_ss_violAuc);
  row.scClassVsSafeSubset = cls(row.d_bts_ss_scAuc);
  row.violClassVsBundle = cls(row.d_bts_b_violAuc);
  row.scClassVsBundle = cls(row.d_bts_b_scAuc);
  // Seed-series level (96 per mask), BTS vs Safe-Subset.
  const seriesCounts = { sc: { lower: 0, equal: 0, higher: 0 }, viol: { lower: 0, equal: 0, higher: 0 } };
  const orgDeltas = new Map();
  for (const k of keys) {
    const t = series["bundle-then-subset"].get(k);
    const s = series["safe-subset"].get(k);
    seriesCounts.sc[cls(t.sc - s.sc)] += 1;
    seriesCounts.viol[cls(t.viol - s.viol)] += 1;
    const o = orgDeltas.get(t.org) ?? { sc: [], viol: [] };
    o.sc.push(t.sc - s.sc); o.viol.push(t.viol - s.viol);
    orgDeltas.set(t.org, o);
  }
  const orgCounts = { sc: { lower: 0, equal: 0, higher: 0 }, viol: { lower: 0, equal: 0, higher: 0 } };
  for (const o of orgDeltas.values()) {
    orgCounts.sc[cls(mean(o.sc))] += 1;
    orgCounts.viol[cls(mean(o.viol))] += 1;
  }
  // Unit-checkpoint level (480 per mask), SC only.
  const cellCounts = { lower: 0, equal: 0, higher: 0 };
  cells[mask]["bundle-then-subset"].forEach((t, i) => {
    const s = cells[mask]["safe-subset"][i];
    if (s.seriesKey !== t.seriesKey || s.fraction !== t.fraction) throw new Error("Cell alignment error.");
    cellCounts[cls(t.sc - s.sc)] += 1;
  });
  Object.assign(row, {
    series_sc_lower: seriesCounts.sc.lower, series_sc_equal: seriesCounts.sc.equal, series_sc_higher: seriesCounts.sc.higher,
    series_viol_lower: seriesCounts.viol.lower, series_viol_equal: seriesCounts.viol.equal, series_viol_higher: seriesCounts.viol.higher,
    orgs_sc_lower: orgCounts.sc.lower, orgs_sc_equal: orgCounts.sc.equal, orgs_sc_higher: orgCounts.sc.higher,
    orgs_viol_lower: orgCounts.viol.lower, orgs_viol_equal: orgCounts.viol.equal, orgs_viol_higher: orgCounts.viol.higher,
    cells_sc_lower: cellCounts.lower, cells_sc_equal: cellCounts.equal, cells_sc_higher: cellCounts.higher,
  });
  perMask.push(row);
}

// Self-check against the committed pooled ablation output.
const byMask = new Map(perMask.map((r) => [r.mask, r]));
const pooled = (masks, short, metric) => mean(masks.map((m) => byMask.get(m)[`${short}_${metric}Auc`]));
const SHORT = { bundle: "b", "safe-subset": "ss", "bundle-then-subset": "bts" };
const METRIC_KEYS = [["sc", "meanSafetyConstrainedVacAuc"], ["viol", "meanViolationExposureAuc"], ["raw", "meanRawVacAuc"]];
let maxAblationDiff = 0;
const checkGroup = (masks, gatesSummary) => {
  for (const gate of GATES) for (const [metric, key] of METRIC_KEYS) {
    if (gatesSummary[gate][key] === undefined) continue;
    maxAblationDiff = Math.max(maxAblationDiff, Math.abs(pooled(masks, SHORT[gate], metric) - gatesSummary[gate][key]));
  }
};
for (const item of ablation.byVerifierSize) {
  checkGroup(perMask.filter((r) => r.verifierSize === item.verifierSize).map((r) => r.mask), item.gates);
}
for (const item of ablation.bySemanticStratumCount) {
  checkGroup(perMask.filter((r) => r.semanticStratumCount === item.retainedStratumCount).map((r) => r.mask), item.gates);
}
for (const item of ablation.leaveOneDevelopmentCaseOut) checkGroup([item.mask], item.gates);
if (maxAblationDiff > 1e-12) {
  throw new Error(`Per-mask replay does not reproduce ${ABLATION_PATH} (max diff ${maxAblationDiff}).`);
}

// Grouped win/tie/loss.
function summarize(label, rows, versus) {
  const p = versus === "safe-subset" ? "ss" : "b";
  const dv = rows.map((r) => r[`d_bts_${p}_violAuc`]);
  const ds = rows.map((r) => r[`d_bts_${p}_scAuc`]);
  const tally = (values) => ({
    lower: values.filter((d) => cls(d) === "lower").length,
    equal: values.filter((d) => cls(d) === "equal").length,
    higher: values.filter((d) => cls(d) === "higher").length,
  });
  const otherViol = mean(rows.map((r) => r[`${p}_violAuc`]));
  const btsViol = mean(rows.map((r) => r.bts_violAuc));
  const out = {
    group: label,
    masks: rows.length,
    violation: tally(dv),
    safetyConstrainedVac: tally(ds),
    meanDeltaViolationAuc: mean(dv),
    medianDeltaViolationAuc: median(dv),
    minDeltaViolationAuc: Math.min(...dv),
    maxDeltaViolationAuc: Math.max(...dv),
    meanDeltaScAuc: mean(ds),
    minDeltaScAuc: Math.min(...ds),
    maxDeltaScAuc: Math.max(...ds),
    meanBtsScAuc: mean(rows.map((r) => r.bts_scAuc)),
    meanComparatorScAuc: mean(rows.map((r) => r[`${p}_scAuc`])),
    meanBtsViolationAuc: btsViol,
    meanComparatorViolationAuc: otherViol,
    comparatorOverBtsViolationRatio: btsViol > 0 ? otherViol / btsViol : null,
  };
  if (versus === "safe-subset") {
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
    out.seedSeriesSc = { lower: sum("series_sc_lower"), equal: sum("series_sc_equal"), higher: sum("series_sc_higher") };
    out.seedSeriesViolation = { lower: sum("series_viol_lower"), equal: sum("series_viol_equal"), higher: sum("series_viol_higher") };
    out.organizationMaskSc = { lower: sum("orgs_sc_lower"), equal: sum("orgs_sc_equal"), higher: sum("orgs_sc_higher") };
    out.unitCheckpointSc = { lower: sum("cells_sc_lower"), equal: sum("cells_sc_equal"), higher: sum("cells_sc_higher") };
  }
  return out;
}
const semanticRows = perMask.filter((r) => r.semanticStratumCount !== null);
const groupsFor = (versus) => ({
  bySemanticStratumCount: [1, 2, 3, 4, 5, 6].map((n) =>
    summarize(`retained semantic strata = ${n}`, semanticRows.filter((r) => r.semanticStratumCount === n), versus)),
  allSemanticMasks: summarize("all 63 semantic-stratum masks", semanticRows, versus),
  byVerifierSize: [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
    summarize(`verifier size = ${n}`, perMask.filter((r) => r.verifierSize === n), versus)),
  allMasks: summarize("all 255 masks (incl. full panel)", perMask, versus),
  weakenedMasks: summarize("254 weakened masks (full panel excluded)", perMask.filter((r) => r.mask !== FULL_MASK), versus),
  escalationCaseD8Absent: summarize("escalation case D8 absent", perMask.filter((r) => !r.d8Present), versus),
  escalationCaseD8Present: summarize("escalation case D8 present", perMask.filter((r) => r.d8Present), versus),
  d8PresentD3Absent: summarize("D8 present, special-approval D3 absent", perMask.filter((r) => r.d8Present && !r.d3Present), versus),
  d8PresentD3Present: summarize("D8 present, special-approval D3 present", perMask.filter((r) => r.d8Present && r.d3Present), versus),
});

const higher = perMask.filter((r) => r.violClassVsSafeSubset === "higher");
const higherComposition = {
  total: higher.length,
  d8PresentD3Absent: higher.filter((r) => r.d8Present && !r.d3Present).length,
  d8PresentD3Present: higher.filter((r) => r.d8Present && r.d3Present).length,
  d8Absent: higher.filter((r) => !r.d8Present).length,
  d8AbsentMasks: higher.filter((r) => !r.d8Present).map((r) => r.caseSet),
  d8PresentD3PresentMasks: higher.filter((r) => r.d8Present && r.d3Present).map((r) => r.caseSet),
};
// Depth sweep quoted in Sec. 4: dropping one, two, three of six strata.
const depthSweep = [5, 4, 3].map((retained) => {
  const g = summarize(`retained = ${retained}`, semanticRows.filter((r) => r.semanticStratumCount === retained), "safe-subset");
  return {
    droppedStrata: 6 - retained,
    masks: g.masks,
    safeSubsetScAuc: g.meanComparatorScAuc,
    btsScAuc: g.meanBtsScAuc,
    bundleScAuc: mean(semanticRows.filter((r) => r.semanticStratumCount === retained).map((r) => r.b_scAuc)),
    safeSubsetViolationAuc: g.meanComparatorViolationAuc,
    btsViolationAuc: g.meanBtsViolationAuc,
    safeSubsetOverBtsViolationRatio: g.comparatorOverBtsViolationRatio,
  };
});

const output = {
  schemaVersion: 1,
  scientificStatus: "post-hoc-camera-ready-per-mask-distribution",
  addedFor: "Camera-ready response to reviews (CLEA #74); not part of any preregistered protocol.",
  modelCalls: 0,
  providerCostUsd: 0,
  arm: "v0.3 DeepSeek confirmatory hidden run set (480 units)",
  frozenRunSetPath: RUN_SET_PATH,
  reproduces: ABLATION_PATH,
  validation: {
    fullVerifierUnitMismatches,
    maxAbsDiffVsCommittedAblationMeans: maxAblationDiff,
  },
  definitions: {
    perMaskMetric: "Mean over the 96 seed series (8 organizations x 4 evidence regimes x 3 seeds) of the trapezoid AUC over the five evidence checkpoints.",
    tieTolerance: EPS,
    lower: "BTS minus comparator < -1e-12",
    semanticMasks: "The 63 masks that keep whole semantic strata (Fig. 1(c) grouping).",
    fullPanel: "Mask 255 (all eight cases) is included in 'all 255 masks'; 254 masks are weakened panels.",
    seedSeries: "One (organization, evidence regime, seed) acquisition curve; 96 per mask, 24,480 in total.",
    unitCheckpoint: "One stored run unit (checkpoint) under one mask; 480 per mask, 122,400 in total.",
  },
  counts: {
    masks: FULL_MASK,
    weakenedMasks: FULL_MASK - 1,
    semanticMasks: semanticRows.length,
    seedSeriesPerMask: 96,
    seedSeriesTotal: 96 * FULL_MASK,
    unitCheckpointsTotal: 480 * FULL_MASK,
    organizationMaskPairs: 8 * FULL_MASK,
  },
  btsVersusSafeSubset: groupsFor("safe-subset"),
  btsVersusBundle: groupsFor("bundle"),
  btsHigherViolationThanSafeSubset: higherComposition,
  depthSweep,
  leaveOneOut: (() => {
    const loo = Array.from({ length: 8 }, (_, i) => byMask.get(FULL_MASK & ~(1 << i)));
    return {
      btsScAuc: mean(loo.map((r) => r.bts_scAuc)),
      btsViolationAuc: mean(loo.map((r) => r.bts_violAuc)),
      safeSubsetScAuc: mean(loo.map((r) => r.ss_scAuc)),
      safeSubsetViolationAuc: mean(loo.map((r) => r.ss_violAuc)),
    };
  })(),
  interpretationGuardrail: "Descriptive sensitivity of one synthetic eight-case verifier in the v0.3 DeepSeek arm; masks are not a random sample of real verifiers. Mean SC-AUC dominance holds per mask and per organization, not per seed series or per unit.",
  perMaskCsv: CSV_PATH,
};

await writeFile(path.join(ROOT, OUTPUT_PATH), `${JSON.stringify(output, null, 2)}\n`, "utf8");
const columns = Object.keys(perMask[0]);
await writeFile(
  path.join(ROOT, CSV_PATH),
  `${columns.join(",")}\n${perMask.map((r) => columns.map((c) => (r[c] === null ? "" : r[c])).join(",")).join("\n")}\n`,
  "utf8",
);
const s = output.btsVersusSafeSubset;
process.stdout.write(`${JSON.stringify({
  outputPath: OUTPUT_PATH,
  modelCalls: 0,
  validation: output.validation,
  allMasksViolation: s.allMasks.violation,
  semanticMasksViolation: s.allSemanticMasks.violation,
  d8Absent: s.escalationCaseD8Absent.violation,
  d8Present: s.escalationCaseD8Present.violation,
  higherComposition: { total: higherComposition.total, d8PresentD3Absent: higherComposition.d8PresentD3Absent },
  scMaskLevel: s.allMasks.safetyConstrainedVac,
  scSeedSeries: s.allMasks.seedSeriesSc,
  scUnitCheckpoints: s.allMasks.unitCheckpointSc,
  scOrganizationMask: s.allMasks.organizationMaskSc,
}, null, 2)}\n`);
