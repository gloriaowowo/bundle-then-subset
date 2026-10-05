#!/usr/bin/env node
// POST-HOC analysis, added for the camera-ready after the authors' post-acceptance critique
// (CLEA #74: "is the evidence-delay result model-conditional, or concentrated in
// one task family?"). ZERO MODEL CALLS: re-aggregation of the stored v0.3
// DeepSeek and v0.3c Gemini hidden run records; nothing is replayed.
//
// Per organization: H3 = mean over that organization's gap-3 seed series of the
// Direct raw-VAC AUC minus the same mean over its gap-0 series (checkpoint
// trapezoid weights 4/32, 8/32, 8/32, 8/32, 4/32). The model x gap interaction
// is the mean over the eight organizations of (Gemini H3 - DeepSeek H3), with a
// two-sided 95% t-interval on n = 8 organizations (df = 7). This is NOT a
// preregistered test; the preregistered H3 is a per-arm organization-cluster
// bootstrap.
// Self-check (throws on mismatch): the mean over organizations of each arm's
// per-organization H3 reproduces the preregistered H3 estimate stored in that
// arm's hidden summary (computed by the frozen summarizer).
// Output: research/h3_by_organization_posthoc.json
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT = "research/h3_by_organization_posthoc.json";
const ARMS = [
  { key: "v03_deepseek", runSet: "research/robustness_v03_deepseek-deepseek-v4-pro_hidden_run_set.json", summary: "research/robustness_v03_deepseek_hidden_summary.json" },
  { key: "v03c_gemini", runSet: "research/robustness_v03c_google-vertex-gemini-3.7-flash_hidden_run_set.json", summary: "research/robustness_v03c_gemini_hidden_summary.json" },
];
const WEIGHTS = new Map([[0, 4 / 32], [8, 8 / 32], [16, 8 / 32], [24, 8 / 32], [32, 4 / 32]]);
const T_975_DF7 = 2.364624251592785; // Student t quantile, 0.975, 7 degrees of freedom
const readJson = async (f) => JSON.parse(await readFile(path.join(ROOT, f), "utf8"));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

const perArm = {};
const domains = {};
for (const arm of ARMS) {
  const runSet = await readJson(arm.runSet);
  const auc = new Map();
  for (const runId of runSet.runIds) {
    const ag = await readJson(`runs/${runId}/aggregate.json`);
    const direct = ag.gateEvaluations.filter((e) => e.gate === "direct");
    if (direct.length !== 1) throw new Error(`${runId}: expected one Direct gate record`);
    domains[ag.organizationId] = ag.domain;
    const key = `${ag.organizationId}|${ag.evidenceRegime}|${ag.trialSeed}`;
    auc.set(key, (auc.get(key) ?? 0) + WEIGHTS.get(ag.checkpoint) * direct[0].verifiedAutomationCoverage);
  }
  const byOrg = {};
  for (const [key, v] of auc) { const [org, regime] = key.split("|"); ((byOrg[org] ??= {})[regime] ??= []).push(v); }
  perArm[arm.key] = Object.fromEntries(Object.entries(byOrg).sort(([a], [b]) => a.localeCompare(b)).map(([org, r]) => [org, mean(r["gap-3"]) - mean(r["gap-0"])]));
  const est = mean(Object.values(perArm[arm.key]));
  const stored = (await readJson(arm.summary)).confirmatoryTests.H3_gap3MinusGap0DirectRawVacAuc.estimate;
  if (Math.abs(est - stored) > 1e-12) throw new Error(`${arm.key}: per-organization H3 mean ${est} != stored preregistered estimate ${stored}`);
}
const orgs = Object.keys(perArm.v03_deepseek);
if (orgs.join() !== Object.keys(perArm.v03c_gemini).join()) throw new Error("organization sets differ between arms");
const diffs = orgs.map((o) => perArm.v03c_gemini[o] - perArm.v03_deepseek[o]);
const m = mean(diffs); const half = T_975_DF7 * sd(diffs) / Math.sqrt(diffs.length);
const byDomain = {};
for (const o of orgs) {
  const d = (byDomain[domains[o]] ??= { organizations: [], deepseekH3: [], geminiH3: [], geminiMinusDeepseek: [] });
  d.organizations.push(o); d.deepseekH3.push(perArm.v03_deepseek[o]); d.geminiH3.push(perArm.v03c_gemini[o]); d.geminiMinusDeepseek.push(perArm.v03c_gemini[o] - perArm.v03_deepseek[o]);
}
for (const d of Object.values(byDomain)) {
  d.meanDeepseekH3 = mean(d.deepseekH3); d.meanGeminiH3 = mean(d.geminiH3); d.meanGeminiMinusDeepseek = mean(d.geminiMinusDeepseek);
  d.organizationsDeepseekNegativeGeminiPositive = d.organizations.filter((_, i) => d.deepseekH3[i] < 0 && d.geminiH3[i] > 0).length;
}
const report = {
  schemaVersion: 1,
  scientificStatus: "post-hoc-h3-by-organization-and-model-gap-interaction",
  addedFor: "Camera-ready, after the authors' post-acceptance critique (CLEA #74): per-organization H3 and the model x evidence-gap interaction. Not preregistered.",
  modelCalls: 0,
  providerCostUsd: 0,
  metric: "Direct raw-VAC AUC, gap-3 minus gap-0, mean over each organization's seed series",
  interval: "two-sided 95% t-interval over the eight organizations (df = 7)",
  selfChecks: { perArmMeanEqualsStoredPreregisteredH3: true },
  h3ByOrganization: Object.fromEntries(orgs.map((o) => [o, { domain: domains[o], deepseek: perArm.v03_deepseek[o], gemini: perArm.v03c_gemini[o], geminiMinusDeepseek: perArm.v03c_gemini[o] - perArm.v03_deepseek[o] }])),
  h3Mean: { deepseek: mean(Object.values(perArm.v03_deepseek)), gemini: mean(Object.values(perArm.v03c_gemini)) },
  modelByGapInteraction: { estimate: m, tInterval95: [m - half, m + half], organizations: diffs.length, organizationsPositive: diffs.filter((d) => d > 0).length },
  byDomain,
};
await writeFile(path.join(ROOT, OUTPUT), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`interaction ${m.toFixed(3)} t-CI [${(m - half).toFixed(3)}, ${(m + half).toFixed(3)}]; positive in ${report.modelByGapInteraction.organizationsPositive}/8 orgs`);
for (const [d, x] of Object.entries(byDomain)) console.log(`  ${d}: DS ${x.meanDeepseekH3.toFixed(3)} Gem ${x.meanGeminiH3.toFixed(3)} diff ${x.meanGeminiMinusDeepseek.toFixed(3)}; DS<0 & Gem>0 in ${x.organizationsDeepseekNegativeGeminiPositive}/${x.organizations.length}`);
