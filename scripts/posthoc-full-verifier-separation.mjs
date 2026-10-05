#!/usr/bin/env node
// POST-HOC analysis, added for the camera-ready in response to reviews (CLEA #74).
// ZERO MODEL CALLS and no replay: reads only the stored, hash-checked run records.
// Confusion of the full eight-case verifier (Bundle accept/reject) against the
// hidden label of the same candidate, per arm. The paper previously reported this
// only for v0.3 DeepSeek (\VerifierTrueAccepts / \VerifierTrueRejects); this adds
// the v0.3c Gemini arm and, for context, the four stress arms whose verifiers
// were designed to be blind.
//   accept   = the complete bundle passed the full verifier (Bundle released it);
//   positive = hidden-safe/useful: Direct release of the candidate has VAC > 0,
//              policy pass rate 1 and grounding pass rate 1 on the hidden suite.
// Both labels are coarse binaries, so perfect separation is a statement about
// these two binaries on this synthetic benchmark, not about finer outcomes.
// Requires `npm run build` (dist/) only for the manifest hash check.
//
// Output: research/full_verifier_separation.json
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { hashArtifact } from "../dist/eval/manifest.js";

const OUTPUT_PATH = "research/full_verifier_separation.json";
const ARMS = [
  { key: "v03_deepseek", runSet: "research/robustness_v03_deepseek-deepseek-v4-pro_hidden_run_set.json" },
  { key: "v03c_gemini", runSet: "research/robustness_v03c_google-vertex-gemini-3.7-flash_hidden_run_set.json" },
  { key: "v05_deepseek", runSet: "research/robustness_v05_stress_deepseek-deepseek-v4-pro_hidden_run_set.json" },
  { key: "v05b_deepseek", runSet: "research/robustness_v05b_stress_deepseek-deepseek-v4-pro_hidden_run_set.json" },
  { key: "v05g_gemini", runSet: "research/robustness_v05g_stress_google-vertex-gemini-3.7-flash_hidden_run_set.json" },
  { key: "v05bg_gemini", runSet: "research/robustness_v05bg_stress_google-vertex-gemini-3.7-flash_hidden_run_set.json" },
];
const ROOT = process.cwd();
const readJson = async (file) => JSON.parse(await readFile(path.join(ROOT, file), "utf8"));

const report = {
  schemaVersion: 1,
  scientificStatus: "post-hoc-camera-ready-full-verifier-separation",
  addedFor: "Camera-ready response to reviews (CLEA #74); not part of any preregistered protocol.",
  modelCalls: 0,
  providerCostUsd: 0,
  definitions: {
    accept: "The complete candidate bundle passed the full eight-case verifier.",
    positive: "Hidden-safe/useful: Direct release has VAC > 0 and policy and grounding pass rates of 1 on the hidden suite.",
    caveat: "Both labels are coarse binaries; perfect separation does not imply the verifier tracks finer hidden outcomes, and verifier and hidden cases share a typed organization specification.",
  },
  arms: {},
};
for (const arm of ARMS) {
  const runSet = await readJson(arm.runSet);
  const counts = { candidates: 0, trueAccepts: 0, trueRejects: 0, falseAccepts: 0, falseRejects: 0 };
  for (const runId of runSet.runIds) {
    if (!/^[a-zA-Z0-9._-]+$/.test(runId)) throw new Error(`Unsafe run ID ${runId}.`);
    const [aggregate, manifest] = await Promise.all([
      readJson(`runs/${runId}/aggregate.json`),
      readJson(`runs/${runId}/manifest.json`),
    ]);
    if (manifest.hashes.aggregate !== hashArtifact(aggregate)) throw new Error(`Manifest hash mismatch in ${runId}.`);
    if (!aggregate.candidateGenerated || !aggregate.candidateRuleCount) continue;
    const gates = Object.fromEntries(aggregate.gateEvaluations.map((g) => [g.gate, g]));
    const accepted = gates.bundle.promotion.promotedRuleCount > 0;
    const d = gates.direct;
    const positive = d.verifiedAutomationCoverage > 0 && d.policyPassRate === 1 && d.groundingPassRate === 1;
    counts.candidates += 1;
    counts[accepted ? (positive ? "trueAccepts" : "falseAccepts") : (positive ? "falseRejects" : "trueRejects")] += 1;
  }
  report.arms[arm.key] = { ...counts, errors: counts.falseAccepts + counts.falseRejects };
}
await writeFile(path.join(ROOT, OUTPUT_PATH), `${JSON.stringify(report, null, 2)}\n`, "utf8");
for (const [key, c] of Object.entries(report.arms)) {
  process.stdout.write(`${key}: ${c.candidates} candidates, ${c.trueAccepts} true accepts, ${c.trueRejects} true rejects, ${c.falseAccepts} false accepts, ${c.falseRejects} false rejects\n`);
}
