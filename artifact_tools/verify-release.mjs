#!/usr/bin/env node
// Erratum-aware verification of the public BTS release. Zero model calls, no
// network, Node.js standard library plus the shipped dist/.
//
//   node artifact_tools/verify-release.mjs
//   node artifact_tools/verify-release.mjs --originals <removed-lines.json>
//
// 1. MANIFEST.json: every file is present with its recorded size and SHA-256,
//    and nothing unlisted ships (local environments and reproduced/ aside).
// 2. ERRATA.json: each redacted file has its released SHA-256, its original
//    line count, and the documented replacement text at exactly the documented
//    lines; for hash-frozen files the recorded frozen SHA-256 is the value the
//    freeze/audit records pin. With --originals (a JSON object
//    {"<path>": {"<line>": "<removed line>"}}, which the authors can provide)
//    each removed line is checked against its pinned SHA-256 and the original
//    file is rebuilt and checked against its original (for hash-frozen files,
//    frozen) SHA-256.
// 3. Freeze lineage: every hash pinned by the eight freeze records is
//    recomputed from the released tree with the frozen hashing code, or
//    attested by ERRATA.json (artifact_tools/verify-freeze-lineage.mjs).
// 4. Frozen audits: the hidden-run audits rerun UNMODIFIED under
//    artifact_tools/erratum-digest-map.mjs and must reproduce the released
//    audit records byte for byte. The v0.5b/v0.5g/v0.5bg arms use the
//    corrected audit copies of research/robustness_v05_stress_freeze_id_erratum.md
//    (the frozen copies are also run and must fail exactly as that erratum says).
// 5. Specifications: specifications/*.json and prompts/ equal the constructor
//    output and re-hash to every frozen benchmark and prompt hash.
// Writes reproduced/verify-release.json.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readCanary, readJson, rel, ROOT, sha256Bytes } from "./lib.mjs";

const argv = process.argv.slice(2);
const originalsIndex = argv.indexOf("--originals");
const originals = originalsIndex >= 0 ? JSON.parse(readFileSync(path.resolve(argv[originalsIndex + 1]), "utf8")) : null;
const HOOK = pathToFileURL(rel("artifact_tools", "erratum-digest-map.mjs")).href;
const say = (line) => process.stdout.write(`${line}\n`);
await mkdir(rel("reproduced", "audits"), { recursive: true });
const report = { schemaVersion: 1, status: "running", modelCalls: 0 };

// ---------------------------------------------------------------- 1. manifest
const canary = await readCanary();
const manifest = await readJson(rel("MANIFEST.json"));
assert.equal(manifest._canary, canary, "MANIFEST.json canary differs from CANARY.txt");
// The release check regenerates these figures in place; their bytes depend on
// local fonts, so (as in the paper) they are reported, not enforced.
const REGENERATED_FIGURES = new Set([
  "paper/figures/robustness_v04.pdf", "paper/figures/robustness_v04.png",
  "paper/figures/mask_paired.pdf", "paper/figures/mask_paired.png",
]);
const IGNORED_DIRS = /^(reproduced|node_modules|\.venv[^/]*|\.figure-cache)(\/|$)/;
const listed = new Set(manifest.files.map((item) => item.path));
let manifestVerified = 0;
const figureNotes = [];
for (const item of manifest.files) {
  const bytes = await readFile(rel(item.path));
  const ok = bytes.length === item.bytes && sha256Bytes(bytes) === item.sha256;
  if (!ok && REGENERATED_FIGURES.has(item.path)) {
    figureNotes.push(`${item.path} differs from the released bytes (regenerated locally; font dependent, not enforced)`);
    continue;
  }
  assert.ok(ok, `${item.path}: size or SHA-256 differs from MANIFEST.json`);
  if (item.canary === "embedded") assert.ok(bytes.toString("utf8").includes(canary), `${item.path}: canary missing`);
  manifestVerified += 1;
}
const unlisted = [];
async function walk(directory) {
  for (const entry of await readdir(rel(directory), { withFileTypes: true })) {
    const relative = directory ? `${directory}/${entry.name}` : entry.name;
    if (IGNORED_DIRS.test(relative)) continue;
    if (entry.isDirectory()) await walk(relative);
    else if (!listed.has(relative) && relative !== "MANIFEST.json" && !relative.endsWith(".DS_Store")) unlisted.push(relative);
  }
}
await walk("");
assert.deepEqual(unlisted, [], `files not in MANIFEST.json: ${unlisted.join(", ")}`);
report.manifest = { files: manifest.files.length, verified: manifestVerified, figureNotes };
say(`ok  manifest: ${manifestVerified}/${manifest.files.length} files match MANIFEST.json${figureNotes.length ? ` (${figureNotes.length} regenerated figure(s) reported)` : ""}`);

// ---------------------------------------------------------------- 2. errata
const errata = await readJson(rel("ERRATA.json"));
assert.equal(errata._canary, canary);
const pinnedBy = {
  "research/robustness_v02_protocol.md": async () => {
    const values = [];
    for (const name of (await readdir(rel("research"))).filter((file) => file.endsWith("_protocol_freeze.json"))) {
      const freeze = await readJson(rel("research", name));
      if (name === "robustness_v02_protocol_freeze.json") values.push(freeze.hashes.protocol);
      else values.push(freeze.preservedV02Hashes.protocol);
    }
    return values;
  },
  "research/robustness_v02_protocol_freeze.json": async () => [(await readJson(rel("research/robustness_v02_hidden_audit.json"))).hashes.freeze],
  "research/robustness_v05g_stress_protocol.md": async () => [(await readJson(rel("research/robustness_v05g_stress_protocol_freeze.json"))).hashes.protocol],
};
const errataRows = [];
for (const entry of errata.files) {
  const bytes = await readFile(rel(entry.path));
  assert.equal(sha256Bytes(bytes), entry.releasedSha256, `${entry.path}: released SHA-256 differs from ERRATA.json`);
  const row = { path: entry.path, kind: entry.kind, hashFrozen: entry.hashFrozen, releasedSha256: entry.releasedSha256, originalSha256: entry.originalSha256 };
  if (entry.hashFrozen) assert.equal(entry.originalSha256, entry.frozenSha256, `${entry.path}: originalSha256 is not the frozen hash`);
  if (entry.kind === "line-redaction") {
    const text = bytes.toString("utf8");
    const lines = text.split("\n");
    assert.equal(lines.length - (text.endsWith("\n") ? 1 : 0), entry.lineCount, `${entry.path}: line count differs from the original file`);
    for (const item of entry.redactions) {
      assert.equal(lines[item.line - 1], item.releasedLine, `${entry.path}:${item.line}: not the documented replacement`);
    }
    row.lines = entry.redactions.map((item) => item.line);
    if (entry.hashFrozen) {
      const pins = await pinnedBy[entry.path]();
      assert.ok(pins.length > 0 && pins.every((value) => value === entry.frozenSha256), `${entry.path}: ERRATA frozen hash is not the value the frozen records pin`);
      row.pinnedByRecords = pins.length;
    }
    if (originals?.[entry.path]) {
      const restored = [...lines];
      for (const item of entry.redactions) {
        const text = originals[entry.path][String(item.line)];
        assert.equal(sha256Bytes(Buffer.from(text, "utf8")), item.removedLineSha256, `${entry.path}:${item.line}: supplied original does not match its pinned hash`);
        restored[item.line - 1] = text;
      }
      assert.equal(sha256Bytes(Buffer.from(restored.join("\n"), "utf8")), entry.originalSha256, `${entry.path}: supplied originals do not rebuild the original file`);
      row.frozenBytesRebuilt = true;
    }
  }
  errataRows.push(row);
}
report.errata = errataRows;
say(`ok  errata: ${errataRows.length} edited file(s) match ERRATA.json${originals ? " (originals checked)" : ""}; hash-frozen ones differ only at the documented lines`);

// ---------------------------------------------------------------- helpers
function node(script, args = [], { hook = false } = {}) {
  return spawnSync(process.execPath, [...(hook ? ["--import", HOOK] : []), script, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C", TZ: "UTC" },
  });
}
const substitutionsOf = (stderr) => stderr.split("\n").filter((line) => line.startsWith("{\"erratumDigestSubstitutions\"")).map((line) => JSON.parse(line).erratumDigestSubstitutions);

// ---------------------------------------------------------------- 3. lineage
{
  const result = node("artifact_tools/verify-freeze-lineage.mjs");
  assert.equal(result.status, 0, `verify-freeze-lineage failed:\n${result.stderr}`);
  const lineage = JSON.parse(result.stdout);
  report.freezeLineage = lineage;
  say(`ok  freeze lineage: ${lineage.frozenHashChecks} pinned hashes in ${lineage.freezeRecords} freeze records (${lineage.recomputed} recomputed, ${lineage.attested} erratum-attested); every hidden run record carries its arm's frozen hashes`);
}

// ---------------------------------------------------------------- 4. audits
const AUDITS = [
  { name: "v0.3 (DeepSeek)", script: "experiments/v03/audit.mjs", args: [], released: ["research/robustness_v03_hidden_audit.json", "research/robustness_v03_deepseek_hidden_audit.json"] },
  { name: "v0.3c (Gemini)", script: "experiments/v03c/audit.mjs", args: ["--run-set", "research/robustness_v03c_google-vertex-gemini-3.7-flash_hidden_run_set.json", "--summary", "research/robustness_v03c_gemini_hidden_summary.json"], released: ["research/robustness_v03c_hidden_audit.json"] },
  { name: "v0.5 (approval-blind, DeepSeek)", script: "experiments/v05_stress/audit.mjs", args: [], released: ["research/robustness_v05_stress_hidden_audit.json"] },
  { name: "v0.5b (escalation-blind, DeepSeek)", script: "scripts/audit-v05b-stress.mjs", args: [], released: ["research/robustness_v05b_stress_hidden_audit.json"], frozenCopy: "experiments/v05b_stress/audit.mjs" },
  { name: "v0.5g (approval-blind, Gemini)", script: "scripts/audit-v05g-stress.mjs", args: ["--run-set", "research/robustness_v05g_stress_google-vertex-gemini-3.7-flash_hidden_run_set.json", "--summary", "research/robustness_v05g_stress_gemini_hidden_summary.json"], released: ["research/robustness_v05g_stress_hidden_audit.json"], frozenCopy: "experiments/v05g_stress/audit.mjs" },
  { name: "v0.5bg (escalation-blind, Gemini)", script: "scripts/audit-v05bg-stress.mjs", args: ["--run-set", "research/robustness_v05bg_stress_google-vertex-gemini-3.7-flash_hidden_run_set.json", "--summary", "research/robustness_v05bg_stress_gemini_hidden_summary.json"], released: ["research/robustness_v05bg_stress_hidden_audit.json"], frozenCopy: "experiments/v05bg_stress/audit.mjs" },
];
report.audits = [];
for (const audit of AUDITS) {
  const out = `reproduced/audits/${path.basename(audit.released[0])}`;
  const result = node(audit.script, [...audit.args, "--out", out], { hook: true });
  assert.equal(result.status, 0, `${audit.script} failed:\n${result.stderr}`);
  const produced = await readFile(rel(out));
  for (const file of audit.released) assert.ok(produced.equals(await readFile(rel(file))), `${audit.script}: output differs from ${file}`);
  const row = { arm: audit.name, script: audit.script, reproduces: audit.released, byteIdentical: true, erratumDigestSubstitutions: substitutionsOf(result.stderr) };
  if (audit.frozenCopy) {
    const frozen = node(audit.frozenCopy, [...audit.args, "--out", `reproduced/audits/frozen-copy-${path.basename(audit.released[0])}`], { hook: true });
    assert.notEqual(frozen.status, 0, `${audit.frozenCopy}: expected the documented benchmark-id failure`);
    assert.match(frozen.stderr, /Manifest mismatch/, `${audit.frozenCopy}: failed for an undocumented reason:\n${frozen.stderr}`);
    row.frozenCopy = { script: audit.frozenCopy, failsAsDocumented: "benchmark.id display string (research/robustness_v05_stress_freeze_id_erratum.md)" };
  }
  report.audits.push(row);
  say(`ok  audit ${audit.name}: ${audit.script} reproduces ${audit.released.join(" and ")} byte for byte`);
}
report.auditsNotRerunnable = [
  { arm: "v0.2", script: "scripts/audit-robustness-v02.mjs", reason: "reads runs/robustness-v02-confirmatory-state.json, a run-state file that was not archived; the released audit's pinned hashes are checked by artifact_tools/audit-and-reproduce.mjs and its run set by the run-set audit there" },
  { arm: "v0.3b", script: "experiments/v03b/audit.mjs", reason: "abandoned partial arm (48 of 480 hidden units, unpooled); no hidden run set or audit record exists" },
];

// ---------------------------------------------------------------- 5. specifications
{
  const result = node("artifact_tools/dump-specifications.mjs", ["--check"]);
  assert.equal(result.status, 0, `dump-specifications --check failed:\n${result.stderr}`);
  report.specifications = JSON.parse(result.stdout);
  say("ok  specifications/ and prompts/ equal the constructor output and re-hash to every frozen benchmark and prompt hash");
}

report.status = "passed";
await writeFile(rel("reproduced", "verify-release.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
say(JSON.stringify({ status: "passed", modelCalls: 0, report: "reproduced/verify-release.json" }));
