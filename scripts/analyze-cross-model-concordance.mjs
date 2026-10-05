#!/usr/bin/env node
// Post-hoc: per-unit bundle-acceptance concordance between the DeepSeek and
// Gemini confirmatory arms. Zero model calls. Decision concordance alone does
// not explain the within-0.002 per-gate SC-AUC agreement: per-unit SC-VAC
// differs in some concordant units, and the net shift from discordant units is
// largely offset by concordant units and by units where only one model
// generated a candidate.
// Paper numbers: bothCandidatesGeneratedConcordant / bothCandidatesGenerated
// (the matched units where both models produced a candidate).
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const readJson = async (file) => JSON.parse(await readFile(path.join(ROOT, file), "utf8"));

async function acceptanceMap(runSetPath) {
  const runSet = await readJson(runSetPath);
  const map = new Map();
  for (const runId of runSet.runIds) {
    const aggregate = await readJson(`runs/${runId}/aggregate.json`);
    const gates = Object.fromEntries(aggregate.gateEvaluations.map((entry) => [entry.gate, entry]));
    const key = [aggregate.organizationId, aggregate.evidenceRegime, aggregate.checkpoint, aggregate.trialSeed].join(":");
    map.set(key, {
      checkpoint: aggregate.checkpoint,
      candidateGenerated: aggregate.candidateGenerated,
      bundleAccepted: (gates.bundle.promotion?.promotedRuleCount ?? 0) > 0,
    });
  }
  return map;
}

const deepseek = await acceptanceMap("research/robustness_v03_deepseek-deepseek-v4-pro_hidden_run_set.json");
const gemini = await acceptanceMap("research/robustness_v03c_google-vertex-gemini-3.7-flash_hidden_run_set.json");
const keys = [...deepseek.keys()].filter((key) => gemini.has(key));
const concordant = keys.filter((key) => deepseek.get(key).bundleAccepted === gemini.get(key).bundleAccepted).length;
const bothGeneratedKeys = keys.filter((key) => deepseek.get(key).candidateGenerated && gemini.get(key).candidateGenerated);
const bothGenerated = bothGeneratedKeys.length;
const bothGeneratedConcordant = bothGeneratedKeys.filter((key) => deepseek.get(key).bundleAccepted === gemini.get(key).bundleAccepted).length;
// Three-way outcome per unit: no candidate / bundle rejected / bundle accepted.
const outcome = (u) => (!u.candidateGenerated ? "no-candidate" : u.bundleAccepted ? "accepted" : "rejected");
const threeWayConcordant = keys.filter((key) => outcome(deepseek.get(key)) === outcome(gemini.get(key))).length;
const checkpointZeroUnits = keys.filter((key) => deepseek.get(key).checkpoint === 0).length;

const report = {
  schemaVersion: 1,
  scientificStatus: "post-hoc-cross-model-acceptance-concordance",
  modelCalls: 0,
  sharedUnitKeys: keys.length,
  bundleAcceptanceConcordant: concordant,
  bundleAcceptanceConcordanceRate: concordant / keys.length,
  bothCandidatesGenerated: bothGenerated,
  bothCandidatesGeneratedConcordant: bothGeneratedConcordant,
  threeWayOutcomeConcordant: threeWayConcordant,
  checkpointZeroUnits,
  definitions: {
    bundleAcceptanceConcordant: "same bundle-accepted boolean; a unit with no candidate counts as not accepted",
    bothCandidatesGeneratedConcordant: "same accept/reject decision among units where both models generated a candidate (the paper's matched units)",
    threeWayOutcomeConcordant: "same outcome among no-candidate / rejected / accepted",
  },
  note: "Accept/reject decision concordance between models. It does not by itself explain the within-0.002 per-gate agreement: per-unit SC-VAC differs in some concordant units, and the net shift from discordant units is largely offset by concordant units and by units where only one model generated a candidate.",
};
await writeFile(path.join(ROOT, "research", "robustness_cross_model_concordance.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(JSON.stringify(report, null, 1) + "\n");
