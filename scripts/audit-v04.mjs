import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { currentFrozenHashes as currentV02Hashes } from "./robustness-v02-freeze-lib.mjs";
import { currentCoreHashes } from "../experiments/v03/integrity.mjs";

const sha256 = async (filePath) => createHash("sha256").update(await readFile(filePath)).digest("hex");
const workspaceRoot = process.cwd();
const paths = {
  v03Freeze: path.join(workspaceRoot, "research", "robustness_v03_protocol_freeze.json"),
  v03RunSet: path.join(workspaceRoot, "research", "robustness_v03_deepseek-deepseek-v4-pro_hidden_run_set.json"),
  v04Protocol: path.join(workspaceRoot, "research", "robustness_v04_stress_protocol.md"),
  verifierScript: path.join(workspaceRoot, "scripts", "posthoc-verifier-ablation-v04.mjs"),
  diagnosticsScript: path.join(workspaceRoot, "scripts", "posthoc-existing-data-v04.mjs"),
  verifierOutput: path.join(workspaceRoot, "research", "robustness_v04_verifier_ablation.json"),
  diagnosticsOutput: path.join(workspaceRoot, "research", "robustness_v04_existing_data_diagnostics.json"),
  auditOutput: path.join(workspaceRoot, "research", "robustness_v04_audit.json"),
};
const [freeze, verifier, diagnostics, currentV03, currentV02] = await Promise.all([
  readFile(paths.v03Freeze, "utf8").then(JSON.parse),
  readFile(paths.verifierOutput, "utf8").then(JSON.parse),
  readFile(paths.diagnosticsOutput, "utf8").then(JSON.parse),
  currentCoreHashes(workspaceRoot),
  currentV02Hashes(workspaceRoot),
]);
const v03HashMatches = Object.fromEntries(Object.entries(freeze.hashes).map(([name, expected]) => [
  name,
  currentV03[name] === expected,
]));
const v02HashMatches = Object.fromEntries(Object.entries(freeze.preservedV02Hashes).map(([name, expected]) => [
  name,
  currentV02[name] === expected,
]));
if (Object.values(v03HashMatches).some((value) => !value)) throw new Error("A frozen v0.3 input changed.");
if (Object.values(v02HashMatches).some((value) => !value)) throw new Error("A preserved v0.2 input changed.");
if (
  verifier.scientificStatus !== "post-hoc-exhaustive-verifier-subset-stress-test" ||
  verifier.modelCalls !== 0 || verifier.providerCostUsd !== 0 || verifier.unitCount !== 480 ||
  verifier.intervention.nonemptyVerifierMasks !== 255 ||
  !verifier.validation.fullVerifierAggregateReproducesV03 ||
  verifier.validation.fullVerifierUnitMismatches !== 0 ||
  verifier.validation.hiddenTaskLevelArtifactsPersisted
) throw new Error("The verifier-ablation output failed its contract.");
if (
  diagnostics.scientificStatus !== "post-hoc-existing-aggregate-diagnostics" ||
  diagnostics.modelCalls !== 0 || diagnostics.providerCostUsd !== 0 ||
  diagnostics.smallClusterRobustness.independentOrganizationClusters !== 8 ||
  diagnostics.verifierDiagnostic.candidateUnits !== 381 ||
  diagnostics.verifierDiagnostic.unitLevel.falsePositive !== 0 ||
  diagnostics.verifierDiagnostic.unitLevel.falseNegative !== 0 ||
  diagnostics.rescueAnatomy.subsetRecoveryUnits !== 70 ||
  diagnostics.hiddenTaskLevelArtifactsPersisted
) throw new Error("The existing-data diagnostic output failed its contract.");

const serialized = JSON.stringify({ verifier, diagnostics });
const forbiddenPatterns = [
  /"hiddenTask(?:Id|Ids|s)?"\s*:/i,
  /"trace(?:s)?"\s*:/i,
  /"grade(?:s)?"\s*:/i,
  /"failureString(?:s)?"\s*:/i,
];
if (forbiddenPatterns.some((pattern) => pattern.test(serialized))) {
  throw new Error("A task-level hidden artifact key was persisted.");
}

const audit = {
  schemaVersion: 1,
  scientificStatus: "post-hoc-v04-audited",
  benchmarkId: verifier.benchmarkId,
  v03FrozenHashesMatch: v03HashMatches,
  preservedV02HashesMatch: v02HashMatches,
  unitCount: verifier.unitCount,
  generatedCandidateUnits: verifier.generatedCandidateUnits,
  uniqueCandidateHashes: verifier.uniqueCandidateHashes,
  exhaustiveVerifierMasks: verifier.intervention.nonemptyVerifierMasks,
  fullVerifierUnitMismatches: verifier.validation.fullVerifierUnitMismatches,
  modelCalls: 0,
  providerCostUsd: 0,
  hiddenTaskLevelArtifactsPersisted: false,
  hashes: Object.fromEntries(await Promise.all(Object.entries(paths)
    .filter(([name]) => name !== "auditOutput")
    .map(async ([name, filePath]) => [name, await sha256(filePath)]))),
};
await writeFile(paths.auditOutput, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ...audit, outputPath: paths.auditOutput }, null, 2)}\n`);
