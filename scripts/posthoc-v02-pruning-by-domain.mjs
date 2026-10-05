#!/usr/bin/env node
// POST-HOC analysis, added for the camera-ready after the authors' post-acceptance critique
// (CLEA #74: "where does harmful pruning come from in the v0.2 discovery
// study?"). ZERO MODEL CALLS: re-aggregation of the stored v0.2 DeepSeek hidden
// run records (research/robustness_v02_hidden_run_set.json); nothing is
// replayed and no provider is contacted.
//
// A pruning event is a hidden unit on which the frozen Bundle gate (full
// eight-case verifier) releases the candidate and Safe-Subset releases fewer
// rules. The event is harmful when Safe-Subset's SC-VAC on the hidden tasks is
// lower than Bundle's, and helpful when higher. Counts are reported per domain
// and organization, with the SC-AUC contribution of the events (checkpoint
// trapezoid weights 4/32, 8/32, 8/32, 8/32, 4/32), summed and averaged over the
// organization's seed series.
// Output: research/v02_pruning_by_domain.json
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT = "research/v02_pruning_by_domain.json";
const RUN_SET = "research/robustness_v02_hidden_run_set.json";
const WEIGHTS = new Map([[0, 4 / 32], [8, 8 / 32], [16, 8 / 32], [24, 8 / 32], [32, 4 / 32]]);
const readJson = async (f) => JSON.parse(await readFile(path.join(ROOT, f), "utf8"));
const runSet = await readJson(RUN_SET);

const orgs = new Map();
const blank = (domain) => ({ domain, units: 0, series: new Set(), bundleAccepted: 0, pruningEvents: 0, harmful: 0, helpful: 0, neutral: 0, scAucContributionSum: 0 });
for (const runId of runSet.runIds) {
  const ag = await readJson(`runs/${runId}/aggregate.json`);
  if (ag.evaluationSplit !== "hidden") throw new Error(`${runId} is not a hidden run`);
  const o = orgs.get(ag.organizationId) ?? orgs.set(ag.organizationId, blank(ag.domain)).get(ag.organizationId);
  o.units++; o.series.add(`${ag.evidenceRegime}:${ag.trialSeed}`);
  const g = Object.fromEntries(ag.gateEvaluations.map((e) => [e.id, e]));
  const b = g["bundle:full-8"]; const s = g["safe-subset:full-8"];
  if (!b || !s) throw new Error(`${runId}: missing full-verifier gate records`);
  if (!((b.promotion.promotedRuleCount ?? 0) > 0)) continue;
  o.bundleAccepted++;
  if (!((s.promotion.promotedRuleCount ?? 0) < b.promotion.promotedRuleCount)) continue;
  o.pruningEvents++;
  const d = s.safetyConstrainedVac - b.safetyConstrainedVac;
  if (d < 0) o.harmful++; else if (d > 0) o.helpful++; else o.neutral++;
  o.scAucContributionSum += d * WEIGHTS.get(ag.checkpoint);
}
const byOrganization = Object.fromEntries([...orgs].sort(([a], [b]) => a.localeCompare(b)).map(([id, o]) => {
  const { series, ...rest } = o;
  return [id, { ...rest, seedSeries: series.size, scAucContributionPerSeries: o.scAucContributionSum / series.size }];
}));
const byDomain = {};
for (const o of Object.values(byOrganization)) {
  const d = (byDomain[o.domain] ??= { organizations: 0, units: 0, bundleAccepted: 0, pruningEvents: 0, harmful: 0, helpful: 0, neutral: 0, organizationsWithHarm: 0 });
  d.organizations++; d.units += o.units; d.bundleAccepted += o.bundleAccepted; d.pruningEvents += o.pruningEvents;
  d.harmful += o.harmful; d.helpful += o.helpful; d.neutral += o.neutral; if (o.harmful > 0) d.organizationsWithHarm++;
}
const sum = (k) => Object.values(byDomain).reduce((s, d) => s + d[k], 0);
const report = {
  schemaVersion: 1,
  scientificStatus: "post-hoc-v02-pruning-harm-by-domain",
  addedFor: "Camera-ready, after the authors' post-acceptance critique (CLEA #74): v0.2 Safe-Subset pruning harm by domain and organization.",
  modelCalls: 0,
  providerCostUsd: 0,
  runSet: RUN_SET,
  units: runSet.runIds.length,
  verifier: "full eight-case verifier (gate records bundle:full-8 and safe-subset:full-8)",
  definitions: {
    pruningEvent: "Bundle releases the candidate and Safe-Subset releases fewer rules",
    harmful: "Safe-Subset hidden SC-VAC < Bundle hidden SC-VAC on that unit",
    scAucContributionSum: "sum over pruning events of (Safe-Subset - Bundle) SC-VAC x checkpoint trapezoid weight",
  },
  totals: { pruningEvents: sum("pruningEvents"), harmful: sum("harmful"), helpful: sum("helpful"), neutral: sum("neutral"), bundleAccepted: sum("bundleAccepted") },
  byDomain,
  byOrganization,
};
await writeFile(path.join(ROOT, OUTPUT), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`v0.2 pruning events ${report.totals.pruningEvents}, harmful ${report.totals.harmful}, helpful ${report.totals.helpful}`);
for (const [d, x] of Object.entries(byDomain)) console.log(`  ${d}: events ${x.pruningEvents}, harmful ${x.harmful}, orgs with harm ${x.organizationsWithHarm}/${x.organizations}`);
for (const [id, o] of Object.entries(byOrganization)) console.log(`  ${id}: events ${o.pruningEvents}, harmful ${o.harmful}, sum ${o.scAucContributionSum.toFixed(3)}, per series ${o.scAucContributionPerSeries.toFixed(4)} (${o.seedSeries} series)`);
