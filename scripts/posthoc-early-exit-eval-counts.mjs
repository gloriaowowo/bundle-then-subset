#!/usr/bin/env node
// POST-HOC analysis, added for the camera-ready after the authors' post-acceptance critique
// (CLEA #74: "the BTS cost saving is measured against the weakest
// implementation"). ZERO MODEL CALLS: stored candidates are replayed through the
// frozen deterministic simulator and grader on the eight development (verifier)
// cases only; no hidden case is touched and no provider is contacted.
//
// Verifier artifact evaluations (one evaluation = one rule subset run on the
// full eight-case verifier) for each gate, summed over generated candidates:
//   safe-subset (plain enumeration) : 2^n - 1 for every candidate
//   bts (frozen)                    : 1 if the bundle is accepted (no policy or
//                                     grounding failure, >= 1 pass), else
//                                     1 + (2^n - 1) (the frozen code re-tests the
//                                     full bundle inside the exhaustive search)
//   max-subset (plain enumeration)  : 2^n - 1 for every candidate
//   max-subset (early exit)         : 1 if the bundle is safe AND passes all
//                                     eight cases (then it is the Max-Subset
//                                     optimum: most passes, most rules), else
//                                     2^n - 1 (the bundle evaluation is reused,
//                                     the most favourable count for Max-Subset)
//   bts-descend / bts-greedy        : accepted path as BTS (1); rejected path
//                                     1 + the evaluations of the exploratory
//                                     recovery searches defined in
//                                     scripts/posthoc-recovery-variants.mjs
// Self-checks (throw on mismatch): BTS and Safe-Subset totals equal the stored
// subsetsEvaluated of the frozen gates; the bundle verdict and pass count equal
// the stored bundle-gate record, so the early-exit count is reproduced from
// stored records alone (second path).
// Requires `npm run build` (dist/). Output: research/early_exit_eval_counts.json
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gradeTrace } from "../dist/eval/grader.js";
import { executeWorkflow } from "../dist/simulator/workflow.js";

const ROOT = process.cwd();
const OUTPUT = "research/early_exit_eval_counts.json";
const readJson = async (f) => JSON.parse(await readFile(path.join(ROOT, f), "utf8"));
const ARMS = [
  { key: "v03_deepseek", experiment: "v03", runSet: "research/robustness_v03_deepseek-deepseek-v4-pro_hidden_run_set.json", regimes: true },
  { key: "v03c_gemini", experiment: "v03c", runSet: "research/robustness_v03c_google-vertex-gemini-3.7-flash_hidden_run_set.json", regimes: true },
];
const grade = (wf, tasks, tools, ids) => tasks.map((t) => { const e = executeWorkflow(wf, t, tools); return gradeTrace(t, e.trace, e.finalState, wf, ids); });
const score = (cand, idxs, tasks, tools, ids) => {
  const trial = structuredClone(cand); trial.rules = idxs.map((i) => structuredClone(cand.rules[i]));
  const g = grade(trial, tasks, tools, ids);
  return { unsafe: g.filter((x) => !(x.policyPass && x.groundingPass)).length, passes: g.filter((x) => x.automatedPass).length };
};
function combos(n, k) { const out = []; const rec = (s, a) => { if (a.length === k) { out.push([...a]); return; } for (let i = s; i < n; i++) { a.push(i); rec(i + 1, a); a.pop(); } }; rec(0, []); return out; }
// Evaluation counts of the two exploratory recovery searches (same definitions
// as scripts/posthoc-recovery-variants.mjs; only the counts are needed here).
function descendEvals(c, tasks, tools, ids) {
  let evals = 0; const n = c.rules.length;
  for (let k = n - 1; k >= 1; k--) {
    let found = false;
    for (const idx of combos(n, k)) { evals++; const s = score(c, idx, tasks, tools, ids); if (s.unsafe === 0 && s.passes > 0) found = true; }
    if (found) return evals;
  }
  return evals;
}
function greedyEvals(c, tasks, tools, ids) {
  let evals = 0; let cur = c.rules.map((_, i) => i);
  while (cur.length > 1) {
    let best;
    for (const drop of cur) {
      const idx = cur.filter((i) => i !== drop); evals++;
      const s = { ...score(c, idx, tasks, tools, ids), idx };
      if (!best || s.unsafe < best.unsafe || (s.unsafe === best.unsafe && s.passes > best.passes)) best = s;
    }
    if (best.unsafe === 0 && best.passes > 0) return evals;
    cur = best.idx;
  }
  return evals;
}

const report = {
  schemaVersion: 1,
  scientificStatus: "post-hoc-early-exit-verifier-evaluation-counts",
  addedFor: "Camera-ready, after the authors' post-acceptance critique (CLEA #74): BTS verifier work against stronger baselines than plain enumeration.",
  modelCalls: 0,
  providerCostUsd: 0,
  unit: "verifier artifact evaluations (one rule subset run on the full eight-case verifier)",
  definitions: {
    safeSubset: "plain enumeration, 2^n-1 per candidate",
    bts: "1 if the bundle is accepted, else 1 + (2^n-1) (frozen code)",
    maxSubsetPlain: "plain enumeration, 2^n-1 per candidate",
    maxSubsetEarlyExit: "1 if the bundle is safe and passes all eight verifier cases, else 2^n-1",
    btsDescend: "1 if accepted, else 1 + evaluations of the decreasing-size search",
    btsGreedy: "1 if accepted, else 1 + evaluations of backward elimination",
  },
  arms: {},
};
for (const arm of ARMS) {
  const { createOrganizations } = await import(`../experiments/${arm.experiment}/benchmark.mjs`);
  const runSet = await readJson(arm.runSet); const cache = new Map();
  const c = { candidates: 0, bundleAccepted: 0, bundleSafeAllPass: 0, safeSubset: 0, bts: 0, maxSubsetPlain: 0, maxSubsetEarlyExit: 0, btsDescend: 0, btsGreedy: 0 };
  const stored = { safeSubset: 0, bts: 0, maxSubsetEarlyExit: 0 };
  for (const runId of runSet.runIds) {
    const [ag, art] = await Promise.all([readJson(`runs/${runId}/aggregate.json`), readJson(`runs/${runId}/artifacts.json`)]);
    if (!ag.candidateGenerated || !art.candidate) continue;
    const cand = art.candidate; const n = cand.rules.length; const all = 2 ** n - 1;
    const regime = arm.regimes ? ag.evidenceRegime : "gap-0"; const k = `${regime}:${ag.organizationId}`;
    if (!cache.has(k)) cache.set(k, createOrganizations(regime).find((o) => o.id === ag.organizationId));
    const org = cache.get(k); const ids = new Set(org.evidence.slice(0, ag.checkpoint).map((e) => e.id));
    const g = grade(cand, org.developmentTasks, org.tools, ids);
    const safe = g.every((x) => x.policyPass && x.groundingPass); const passes = g.filter((x) => x.automatedPass).length;
    const accepted = safe && passes > 0; const allPass = safe && passes === g.length;
    c.candidates++; if (accepted) c.bundleAccepted++; if (allPass) c.bundleSafeAllPass++;
    c.safeSubset += all; c.maxSubsetPlain += all;
    c.bts += accepted ? 1 : 1 + all;
    c.maxSubsetEarlyExit += allPass ? 1 : all;
    c.btsDescend += accepted ? 1 : 1 + descendEvals(cand, org.developmentTasks, org.tools, ids);
    c.btsGreedy += accepted ? 1 : 1 + greedyEvals(cand, org.developmentTasks, org.tools, ids);
    // Second path: the stored frozen-gate records.
    const st = Object.fromEntries(ag.gateEvaluations.map((e) => [e.gate, e.promotion]));
    stored.safeSubset += st["safe-subset"].subsetsEvaluated;
    stored.bts += st["bundle-then-subset"].subsetsEvaluated;
    const b = st.bundle; const sn = 2 ** b.candidateRuleCount - 1;
    if (b.candidateRuleCount !== n) throw new Error(`${runId}: stored rule count ${b.candidateRuleCount} != ${n}`);
    const storedAllPass = b.developmentPolicyFailures === 0 && b.developmentGroundingFailures === 0 && b.developmentAutomatedPasses === org.developmentTasks.length;
    if (storedAllPass !== allPass || ((b.promotedRuleCount ?? 0) > 0) !== accepted) throw new Error(`${runId}: replayed bundle verdict differs from the stored record`);
    stored.maxSubsetEarlyExit += storedAllPass ? 1 : sn;
  }
  for (const key of Object.keys(stored)) if (stored[key] !== c[key]) throw new Error(`${arm.key}: ${key} replay ${c[key]} != stored ${stored[key]}`);
  report.arms[arm.key] = {
    ...c,
    btsSavingVsSafeSubset: 1 - c.bts / c.safeSubset,
    btsSavingVsMaxSubsetEarlyExit: 1 - c.bts / c.maxSubsetEarlyExit,
    btsExtraVsDescend: c.bts / c.btsDescend - 1,
    btsExtraVsGreedy: c.bts / c.btsGreedy - 1,
    secondPathStoredRecords: stored,
  };
  process.stderr.write(`${arm.key} done\n`);
}
await writeFile(path.join(ROOT, OUTPUT), `${JSON.stringify(report, null, 2)}\n`, "utf8");
for (const [k, a] of Object.entries(report.arms)) {
  console.log(`${k}: candidates ${a.candidates}, SS ${a.safeSubset}, BTS ${a.bts}, Max early-exit ${a.maxSubsetEarlyExit} (BTS saves ${(100 * a.btsSavingVsMaxSubsetEarlyExit).toFixed(1)}%), descend ${a.btsDescend}, greedy ${a.btsGreedy}`);
}
