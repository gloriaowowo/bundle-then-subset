#!/usr/bin/env node
// Erratum-aware verification of every freeze record in research/.
//
// Each freeze pins SHA-256 hashes of the benchmark constructor output, the
// implementation directory, the compiled runtime (dist/), the prompt contract,
// the protocol, package.json and package-lock.json; the later freezes also
// preserve the v0.2 hashes. This tool recomputes every pinned value from the
// released tree with the frozen hashing code itself (scripts/robustness-v02-
// freeze-lib.mjs and experiments/<arm>/integrity.mjs) and classifies it:
//
//   recomputed     the released bytes reproduce the frozen hash
//   attested       a file redacted for the public release (ERRATA.md): the
//                  released bytes match ERRATA.json's released hash and the
//                  erratum records the frozen hash. The removed lines are not
//                  public, so this hash is attested rather than recomputed;
//                  verify-release.mjs checks that the file differs from the
//                  frozen original only at the documented lines
//
// Anything else fails. It then checks that every archived hidden-split run
// record carries its arm's frozen implementation, runtime, benchmark and
// prompt hashes (development records are reported, not enforced: most
// development runs predate their freeze).
//
// The frozen audit scripts (experiments/*/audit.mjs, scripts/audit-*.mjs)
// ship unmodified; verify-release.mjs reruns them under the erratum digest
// map (artifact_tools/erratum-digest-map.mjs).
// Needs dist/ as compiled by TypeScript 7.0.2 (shipped; `npx tsc -p tsconfig.json` rebuilds it identically).
import assert from "node:assert/strict";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadErrata, readJson, rel, sha256Bytes, sha256File, ROOT } from "./lib.mjs";

const errata = await loadErrata();
const ARMS = [
  { name: "v0.2", freeze: "research/robustness_v02_protocol_freeze.json", lib: "scripts/robustness-v02-freeze-lib.mjs", fn: "currentFrozenHashes", protocol: "research/robustness_v02_protocol.md", runPrefix: "v02" },
  { name: "v0.3", freeze: "research/robustness_v03_protocol_freeze.json", lib: "experiments/v03/integrity.mjs", dir: "experiments/v03", protocol: "research/robustness_v03_protocol.md", runPrefix: "v03" },
  { name: "v0.3b", freeze: "research/robustness_v03b_protocol_freeze.json", lib: "experiments/v03b/integrity.mjs", dir: "experiments/v03b", protocol: "research/robustness_v03b_protocol.md", runPrefix: "v03b" },
  { name: "v0.3c", freeze: "research/robustness_v03c_protocol_freeze.json", lib: "experiments/v03c/integrity.mjs", dir: "experiments/v03c", protocol: "research/robustness_v03c_protocol.md", runPrefix: "v03c" },
  { name: "v0.5", freeze: "research/robustness_v05_stress_protocol_freeze.json", lib: "experiments/v05_stress/integrity.mjs", dir: "experiments/v05_stress", protocol: "research/robustness_v05_stress_protocol.md", runPrefix: "v05s" },
  { name: "v0.5b", freeze: "research/robustness_v05b_stress_protocol_freeze.json", lib: "experiments/v05b_stress/integrity.mjs", dir: "experiments/v05b_stress", protocol: "research/robustness_v05b_stress_protocol.md", runPrefix: "v05bs" },
  { name: "v0.5g", freeze: "research/robustness_v05g_stress_protocol_freeze.json", lib: "experiments/v05g_stress/integrity.mjs", dir: "experiments/v05g_stress", protocol: "research/robustness_v05g_stress_protocol.md", runPrefix: "v05gs" },
  { name: "v0.5bg", freeze: "research/robustness_v05bg_stress_protocol_freeze.json", lib: "experiments/v05bg_stress/integrity.mjs", dir: "experiments/v05bg_stress", protocol: "research/robustness_v05bg_stress_protocol.md", runPrefix: "v05bgs" },
];

// Which released file (or directory) each frozen hash key covers.
function coveredPath(arm, key) {
  return {
    protocol: arm.protocol,
    packageJson: "package.json",
    packageLock: "package-lock.json",
    analysis: "src/summarize-robustness.ts",
    confirmatoryOrchestrator: "scripts/run-robustness-confirmatory.mjs",
    freezeLibrary: "scripts/robustness-v02-freeze-lib.mjs",
    implementationAllTypescriptUnderSrc: "src",
    v03ImplementationAllMjs: arm.dir,
    importedRuntimeAllDistJs: "dist",
  }[key];
}

function classify(arm, key, expected, actual) {
  if (actual === expected) return "recomputed";
  const covered = coveredPath(arm, key);
  const entry = errata.files.find((item) => item.path === covered && item.hashFrozen);
  if (entry && entry.frozenSha256 === expected && entry.releasedSha256 === actual) return "attested";
  throw new Error(`${arm.name}: frozen ${key} (${covered}) = ${expected}, released tree gives ${actual}, and no erratum explains it`);
}

const v02Lib = await import(pathToFileURL(rel("scripts/robustness-v02-freeze-lib.mjs")).href);
const v02Current = await v02Lib.currentFrozenHashes(ROOT);
const report = [];
const freezes = {};
for (const arm of ARMS) {
  const freeze = await readJson(rel(arm.freeze));
  freezes[arm.runPrefix] = freeze;
  const lib = await import(pathToFileURL(rel(arm.lib)).href);
  const current = arm.fn ? await lib[arm.fn](ROOT) : await lib.currentCoreHashes(ROOT);
  const hashes = {};
  for (const [key, expected] of Object.entries(freeze.hashes)) hashes[key] = classify(arm, key, expected, current[key]);
  const preserved = {};
  for (const [key, expected] of Object.entries(freeze.preservedV02Hashes ?? {})) {
    preserved[key] = classify(ARMS[0], key, expected, v02Current[key]);
  }
  const freezeSha = await sha256File(rel(arm.freeze));
  const freezeErratum = errata.files.find((item) => item.path === arm.freeze);
  report.push({
    arm: arm.name,
    freezeRecord: arm.freeze,
    freezeRecordBytes: freezeErratum ? "redacted (authorizationMessage); see ERRATA.md" : "byte-identical to the frozen record",
    freezeRecordSha256: freezeSha,
    hashes,
    ...(freeze.preservedV02Hashes ? { preservedV02Hashes: preserved } : {}),
  });
}

// Run-record lineage: every archived hidden record carries its arm's frozen hashes.
const runLineage = {};
for (const entry of (await readdir(rel("runs"), { withFileTypes: true })).filter((item) => item.isDirectory())) {
  const prefix = entry.name.match(/^robustness-(v0[0-9]+[a-z]*)-/)?.[1];
  const freeze = freezes[prefix];
  assert.ok(freeze, `${entry.name}: no freeze for run prefix ${prefix}`);
  const [manifest, aggregate] = await Promise.all([
    readJson(rel("runs", entry.name, "manifest.json")),
    readJson(rel("runs", entry.name, "aggregate.json")),
  ]);
  const h = manifest.hashes;
  const matches = prefix === "v02"
    ? h.implementation === freeze.hashes.implementationAllTypescriptUnderSrc && h.promptContract === freeze.hashes.promptContract
    : h.v03Implementation === freeze.hashes.v03ImplementationAllMjs &&
      h.importedRuntime === freeze.hashes.importedRuntimeAllDistJs &&
      h.benchmark === freeze.hashes.benchmarkAllRegimes &&
      h.promptContract === freeze.hashes.promptContract;
  const key = `${prefix}:${aggregate.evaluationSplit}`;
  runLineage[key] ??= { recordsMatchingFreeze: 0, recordsNotMatchingFreeze: 0 };
  runLineage[key][matches ? "recordsMatchingFreeze" : "recordsNotMatchingFreeze"] += 1;
  if (aggregate.evaluationSplit === "hidden") assert.ok(matches, `${entry.name}: hidden record does not carry its arm's frozen hashes`);
}

const statuses = report.flatMap((row) => [...Object.values(row.hashes), ...Object.values(row.preservedV02Hashes ?? {})]);
const tally = (value) => statuses.filter((item) => item === value).length;
const output = {
  schemaVersion: 1,
  status: "passed",
  modelCalls: 0,
  freezeRecords: report.length,
  frozenHashChecks: statuses.length,
  recomputed: tally("recomputed"),
  attested: tally("attested"),
  freezes: report,
  hiddenRunRecordsAllMatchTheirFreeze: true,
  runLineage,
  knownFreezeRecordErratum: "research/robustness_v05_stress_freeze_id_erratum.md (benchmark.id display strings in the v0.5b/v0.5g/v0.5bg freezes; hashes unaffected)",
};
await mkdir(rel("reproduced"), { recursive: true });
await writeFile(rel("reproduced", "freeze-lineage.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({
  status: output.status,
  freezeRecords: output.freezeRecords,
  frozenHashChecks: output.frozenHashChecks,
  recomputed: output.recomputed,
  attested: output.attested,
  hiddenRunRecordsAllMatchTheirFreeze: true,
  report: path.join("reproduced", "freeze-lineage.json"),
}, null, 2)}\n`);
