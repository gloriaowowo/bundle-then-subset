#!/usr/bin/env node
// Reruns every hidden evaluation that is not part of
// `node scripts/release-camera-ready.mjs --with-hidden`, on the released
// retired hidden panels, with zero model calls, and requires each output to
// match the released records.
//
//   node artifact_tools/rerun-hidden.mjs            # everything (about 4 minutes)
//   node artifact_tools/rerun-hidden.mjs --quick    # skip the 255-mask v0.4 verifier ablation
//
// 1. Validation of every constructor: experiments/<arm>/validate.mjs (the
//    oracle workflow passes every development and hidden case) and, for v0.2,
//    dist/gate-robustness.js (panel composition and gate plumbing).
// 2. The original hidden evaluations: artifact_tools/replay-hidden-gates.mjs
//    re-executes every stored hidden gate evaluation of the seven hidden runs
//    (v0.2, v0.3, v0.3c, and the four stress arms; 12,480 gate evaluations)
//    and requires each rebuilt record to equal the stored one.
// 3. Stress-arm hidden summaries (scripts/summarize-v05{,b,g,bg}-stress.mjs),
//    re-aggregated from those records; byte-identical.
// 4. v0.4 post-hoc replays on the v0.3 hidden panels: the 255-mask verifier
//    ablation, the retention replay, and their audits; byte-identical.
// Scripts write their outputs in place (research/); a byte difference restores
// the released file and fails the command. Every script runs unmodified under
// artifact_tools/erratum-digest-map.mjs (see ERRATA.md); substitutions are
// reported. Results go to reproduced/rerun-hidden.json.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { rel, ROOT, sha256Bytes } from "./lib.mjs";

const quick = process.argv.includes("--quick");
const HOOK = pathToFileURL(rel("artifact_tools", "erratum-digest-map.mjs")).href;
await mkdir(rel("reproduced"), { recursive: true });
const digestLog = rel("reproduced", ".erratum-digest.log");

function runScript(script, args = []) {
  const started = Date.now();
  rmSync(digestLog, { force: true });
  const stdout = execFileSync(process.execPath, ["--import", HOOK, script, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C", TZ: "UTC", BTS_ERRATUM_DIGEST_LOG: digestLog },
  });
  return { stdout, seconds: Math.round((Date.now() - started) / 100) / 10 };
}

async function substitutions() {
  try {
    const lines = (await readFile(digestLog, "utf8")).trim().split("\n").filter(Boolean);
    await rm(digestLog, { force: true });
    return lines.map((line) => JSON.parse(line).erratumDigestSubstitutions);
  } catch {
    return [];
  }
}

async function inPlace(script, outputs, args = []) {
  const before = await Promise.all(outputs.map((file) => readFile(rel(file))));
  let result;
  try {
    result = runScript(script, args);
  } finally {
    for (const [index, file] of outputs.entries()) {
      const after = await readFile(rel(file));
      if (!after.equals(before[index])) {
        await writeFile(rel(file), before[index]);
        throw new Error(`${file}: rerun output differs from the released bytes (released file restored)`);
      }
    }
  }
  process.stdout.write(`ok  ${script} (${result.seconds} s): ${outputs.join(", ")} byte-identical\n`);
  return {
    script,
    outputs: await Promise.all(outputs.map(async (file) => ({ file, sha256: sha256Bytes(await readFile(rel(file))), byteIdentical: true }))),
    seconds: result.seconds,
    erratumDigestSubstitutions: await substitutions(),
  };
}

const report = { schemaVersion: 1, status: "running", modelCalls: 0, validations: [], reruns: [] };

for (const arm of ["v03", "v03b", "v03c", "v05_stress", "v05b_stress", "v05g_stress", "v05bg_stress"]) {
  const script = `experiments/${arm}/validate.mjs`;
  const { stdout, seconds } = runScript(script);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.status, "valid", `${script}: not valid`);
  process.stdout.write(`ok  ${script} (${seconds} s): ${parsed.oracleTaskEvaluations} oracle task evaluations pass\n`);
  report.validations.push({ script, ...parsed, seconds, erratumDigestSubstitutions: await substitutions() });
}

{
  // v0.2 constructor: dist/gate-robustness.js checks panel composition on all
  // four regimes and gate plumbing with a fixture candidate (no provider). It
  // writes a throwaway fixture cache under runs/gate-robustness-*; removed here.
  const before = new Set(await readdir(rel("runs")));
  const { stdout, seconds } = runScript("dist/gate-robustness.js");
  for (const entry of await readdir(rel("runs"))) {
    if (!before.has(entry) && /^gate-robustness-\d+-\d+$/.test(entry)) await rm(rel("runs", entry), { recursive: true, force: true });
  }
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.paidModelRequestMade, false);
  assert.equal(parsed.organizations, 8);
  process.stdout.write(`ok  dist/gate-robustness.js (${seconds} s): v0.2 constructor panels and gate plumbing valid on ${parsed.evidenceGapRegimes.length} regimes\n`);
  report.validations.push({ script: "dist/gate-robustness.js", ...parsed, seconds, erratumDigestSubstitutions: await substitutions() });
}

{
  const { stdout, seconds } = runScript("artifact_tools/replay-hidden-gates.mjs");
  const replay = JSON.parse(await readFile(rel("reproduced", "replay-hidden-gates.json"), "utf8"));
  assert.equal(replay.status, "passed", "artifact_tools/replay-hidden-gates.mjs: stored hidden gate evaluations not reproduced");
  assert.equal(replay.runs.length, 7);
  process.stdout.write(stdout.split("\n").filter((line) => line.startsWith("ok  ")).join("\n") + "\n");
  process.stdout.write(`ok  artifact_tools/replay-hidden-gates.mjs (${seconds} s): ${replay.totals.gateEvaluations} stored hidden gate evaluations re-executed, ${replay.totals.mismatches} mismatches\n`);
  report.hiddenGateReplay = { script: "artifact_tools/replay-hidden-gates.mjs", ...replay.totals, seconds, report: "reproduced/replay-hidden-gates.json" };
}

report.reruns.push(await inPlace("scripts/summarize-v05-stress.mjs", ["research/robustness_v05_stress_deepseek_hidden_summary.json"]));
report.reruns.push(await inPlace("scripts/summarize-v05b-stress.mjs", ["research/robustness_v05b_stress_deepseek_hidden_summary.json"]));
report.reruns.push(await inPlace("scripts/summarize-v05g-stress.mjs", ["research/robustness_v05g_stress_gemini_hidden_summary.json"]));
report.reruns.push(await inPlace("scripts/summarize-v05bg-stress.mjs", ["research/robustness_v05bg_stress_gemini_hidden_summary.json"]));
if (quick) {
  process.stdout.write("skip scripts/posthoc-verifier-ablation-v04.mjs (--quick); its output is checked by scripts/audit-v04.mjs below\n");
} else {
  report.reruns.push(await inPlace("scripts/posthoc-verifier-ablation-v04.mjs", ["research/robustness_v04_verifier_ablation.json"]));
}
report.reruns.push(await inPlace("scripts/posthoc-existing-data-v04.mjs", ["research/robustness_v04_existing_data_diagnostics.json"]));
report.reruns.push(await inPlace("scripts/audit-v04.mjs", ["research/robustness_v04_audit.json"]));
report.reruns.push(await inPlace("scripts/posthoc-retention-v04.mjs", ["research/robustness_v04_retention_summary.json"]));
report.reruns.push(await inPlace("scripts/audit-retention-v04.mjs", ["research/robustness_v04_retention_audit.json"]));

report.status = "passed";
report.quick = quick;
await writeFile(rel("reproduced", "rerun-hidden.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({
  status: report.status,
  modelCalls: 0,
  oracleValidations: report.validations.length,
  hiddenGateEvaluationsReplayed: report.hiddenGateReplay.gateEvaluations,
  byteIdenticalReruns: report.reruns.length,
  ablationRerun: !quick,
  report: path.join("reproduced", "rerun-hidden.json"),
}, null, 2)}\n`);
