import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const values = process.argv.slice(2);
const outIndex = values.indexOf("--out");
if (outIndex < 0 || !values[outIndex + 1]) {
  throw new Error("Usage: node combine-runsets.mjs --out OUTPUT INPUT [INPUT ...]");
}
const outputPath = path.resolve(process.cwd(), values[outIndex + 1]);
const inputPaths = values.filter((_, index) => index !== outIndex && index !== outIndex + 1);
if (inputPaths.length < 1) throw new Error("At least one input run set is required.");
const runSets = await Promise.all(inputPaths.map((filePath) =>
  readFile(path.resolve(process.cwd(), filePath), "utf8").then(JSON.parse),
));
const first = runSets[0];
for (const runSet of runSets) {
  for (const key of ["benchmarkId", "evaluationSplit", "organizations", "evidenceRegimes", "checkpoints", "trialSeeds"]) {
    if (JSON.stringify(runSet[key]) !== JSON.stringify(first[key])) {
      throw new Error(`Run sets disagree on ${key}.`);
    }
  }
}
const models = runSets.flatMap((runSet) => runSet.models);
const runIds = runSets.flatMap((runSet) => runSet.runIds);
if (new Set(models.map((model) => `${model.provider}:${model.id}`)).size !== models.length) {
  throw new Error("Run sets contain a duplicate model.");
}
if (new Set(runIds).size !== runIds.length) throw new Error("Run sets contain duplicate runs.");
const combined = {
  ...first,
  label: `robustness-v0.5bgs-combined-${first.evaluationSplit}`,
  models,
  runIds,
  scientificStatus: first.evaluationSplit === "hidden"
    ? "confirmatory-hidden-aggregate-cross-model"
    : "exploratory-development-only-cross-model",
};
await writeFile(outputPath, `${JSON.stringify(combined, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status: "complete", outputPath, models, runs: runIds.length }, null, 2)}\n`);

