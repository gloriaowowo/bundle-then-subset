import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (file) => JSON.parse(await readFile(path.join(ROOT, file), "utf8"));
await mkdir(path.join(ROOT, "reproduced"), { recursive: true });
const cases = [
  ["robustness_v03c_google-vertex-gemini-3.7-flash_development_run_set.json", "robustness_v03c_development_summary.json"],
  ["robustness_v03c_google-vertex-gemini-3.7-flash_hidden_run_set.json", "robustness_v03c_gemini_hidden_summary.json"],
  ["robustness_v03_combined_hidden_run_set.json", "robustness_v03_combined_hidden_summary.json"],
];
const results = [];
for (const [runSet, published] of cases) {
  const out = path.join("reproduced", published);
  execFileSync(process.execPath, [
    path.join(ROOT, "experiments", "v03c", "summarize.mjs"),
    "--run-set", path.join("research", runSet),
    "--out", out,
  ], { cwd: ROOT, stdio: "inherit", env: { ...process.env, LANG: "C", LC_ALL: "C", TZ: "UTC" } });
  const [expected, actual] = await Promise.all([readJson(path.join("research", published)), readJson(out)]);
  assert.deepEqual(actual, expected, published + ": reproduced summary differs");
  results.push({ published, exactJsonMatch: true });
}
process.stdout.write(JSON.stringify({ status: "v03c-reproduced", results }, null, 2) + "\n");
