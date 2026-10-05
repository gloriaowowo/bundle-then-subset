#!/usr/bin/env node
// Camera-ready release check (CLEA #74). Zero model calls.
//
//   node scripts/release-camera-ready.mjs                 # aggregate-only analyses; hidden-replay outputs hash-checked
//   node scripts/release-camera-ready.mjs --with-hidden   # also rerun the hidden-case replays (constructors are released)
//   node scripts/release-camera-ready.mjs --freeze        # (re)write the frozen hash manifest
//
// Run from the release (or repository) root. Needs Node.js >= 20 and dist/
// (shipped in the public release; in a source checkout run
// `npm ci && npm run build`), plus .venv-figures for step 4.
//
// Steps:
//   1. Hidden-dependent analyses (verifier-mask replay, retained-rule accounting,
//      Max-Subset control, recovery variants, and the post-acceptance early-exit
//      evaluation counts, Max-Subset mask replay and pruned-rule verifier
//      behaviour) replay stored candidates on the retired panels built by
//      experiments/*/benchmark.mjs. With --with-hidden they are rerun (about 4
//      minutes); without it they are skipped and only their released outputs
//      are hash-checked.
//   2. Aggregate-only analyses (verifier work, full-verifier separation,
//      cross-model concordance, stress-arm cache pairing, and the post-acceptance
//      v0.2 pruning-by-domain and per-organization H3 tables) always rerun from
//      the stored run records.
//   3. emit-results-cr.mjs rebuilds results_cr.tex and the cr_table_*.tex snippets.
//   4. The camera-ready figure scripts rerun (needs .venv-figures from
//      requirements-figures.lock).
//   5. Every analysis output and emitted LaTeX file is checked against
//      research/camera_ready_output_hashes.json; any mismatch fails the command.
//      Figure PDFs depend on local fonts, so their hashes are reported, not enforced.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const withHidden = args.has("--with-hidden");
const freeze = args.has("--freeze");
const MANIFEST = "research/camera_ready_output_hashes.json";

const HIDDEN_DEPENDENT = [
  ["scripts/posthoc-v04-mask-distribution.mjs", ["research/robustness_v04_mask_distribution.json", "research/robustness_v04_mask_distribution_per_mask.csv"]],
  ["scripts/posthoc-retention-cost.mjs", ["research/retention_cost_accounting.json"]],
  ["scripts/analyze-max-subset.mjs", ["research/robustness_max_subset_baseline.json"]],
  ["scripts/posthoc-recovery-variants.mjs", ["research/recovery_variants_posthoc.json"]],
  // Added for the camera-ready after the authors' post-acceptance critique (post-hoc, zero model calls).
  ["scripts/posthoc-early-exit-eval-counts.mjs", ["research/early_exit_eval_counts.json"]],
  ["scripts/posthoc-max-subset-masks.mjs", ["research/max_subset_masks_posthoc.json"]],
  ["scripts/posthoc-pruned-rules-verifier.mjs", ["research/pruned_rules_verifier_posthoc.json"]],
];
const AGGREGATE_ONLY = [
  ["scripts/posthoc-verifier-work.mjs", ["research/verifier_work_by_rulecount.json"]],
  ["scripts/posthoc-full-verifier-separation.mjs", ["research/full_verifier_separation.json"]],
  ["scripts/analyze-cross-model-concordance.mjs", ["research/robustness_cross_model_concordance.json"]],
  ["scripts/posthoc-stress-pairing.mjs", ["research/stress_arm_cache_pairing.json"]],
  // Added for the camera-ready after the authors' post-acceptance critique (post-hoc, zero model calls).
  ["scripts/posthoc-v02-pruning-by-domain.mjs", ["research/v02_pruning_by_domain.json"]],
  ["scripts/posthoc-h3-by-org.mjs", ["research/h3_by_organization_posthoc.json"]],
];
// Precomputed (hidden-derived) inputs of Figure 1, released as outputs.
const FIGURE_INPUTS = [
  "research/robustness_v03_deepseek_hidden_summary.json",
  "research/robustness_v04_existing_data_diagnostics.json",
  "research/robustness_v04_verifier_ablation.json",
];
const EMITTED = [
  "paper/latex/results_cr.tex",
  "paper/latex/cr_table_masks.tex",
  "paper/latex/cr_table_verifier_work.tex",
  "paper/latex/cr_table_retention.tex",
];
const FIGURES = [
  ["scripts/plot-robustness-v04.py", ["paper/figures/robustness_v04.pdf"]],
  ["scripts/plot-mask-paired.py", ["paper/figures/mask_paired.pdf"]],
];

const sha256 = (file) => createHash("sha256").update(readFileSync(path.join(ROOT, file))).digest("hex");
const run = (cmd, argv, env = {}) => {
  process.stdout.write(`$ ${cmd} ${argv.join(" ")}\n`);
  execFileSync(cmd, argv, { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, ...env } });
};

if (withHidden) {
  if (!existsSync(path.join(ROOT, "experiments/v03/benchmark.mjs"))) {
    throw new Error("--with-hidden needs the hidden-case constructors (experiments/*/benchmark.mjs), which are missing from this checkout.");
  }
  for (const [script] of HIDDEN_DEPENDENT) run("node", [script]);
} else {
  process.stdout.write("Skipping hidden-case replays; their released outputs are hash-checked below.\n");
}
for (const [script] of AGGREGATE_ONLY) run("node", [script]);
run("node", ["scripts/emit-results-cr.mjs"]);
if (!existsSync(path.join(ROOT, ".venv-figures/bin/python"))) {
  throw new Error("Missing .venv-figures; create it with `python3 -m venv .venv-figures && .venv-figures/bin/pip install -r requirements-figures.lock` before running the release check.");
}
for (const [script] of FIGURES) run("sh", ["scripts/run-figure-python.sh", script], { SOURCE_DATE_EPOCH: "0" });

const enforced = [...HIDDEN_DEPENDENT, ...AGGREGATE_ONLY].flatMap(([, outputs]) => outputs).concat(FIGURE_INPUTS, EMITTED);
const reported = FIGURES.flatMap(([, outputs]) => outputs);
const current = {
  enforced: Object.fromEntries(enforced.map((file) => [file, sha256(file)])),
  reportedOnly: Object.fromEntries(reported.map((file) => [file, sha256(file)])),
};

if (freeze) {
  writeFileSync(path.join(ROOT, MANIFEST), `${JSON.stringify({
    schemaVersion: 1,
    scientificStatus: "camera-ready-output-hashes",
    modelCalls: 0,
    note: "SHA-256 of every camera-ready analysis output and emitted LaTeX file; figure PDF hashes depend on local fonts and are reported only.",
    ...current,
  }, null, 2)}\n`);
  process.stdout.write(`Froze ${enforced.length} enforced and ${reported.length} reported hashes in ${MANIFEST}.\n`);
  process.exit(0);
}

const frozen = JSON.parse(readFileSync(path.join(ROOT, MANIFEST), "utf8"));
const mismatches = enforced.filter((file) => frozen.enforced[file] !== current.enforced[file]);
for (const file of reported) {
  if (frozen.reportedOnly?.[file] !== current.reportedOnly[file]) process.stdout.write(`note: ${file} differs from the frozen bytes (font/environment dependent; not enforced)\n`);
}
if (mismatches.length > 0) {
  for (const file of mismatches) process.stderr.write(`HASH MISMATCH: ${file}\n`);
  process.exit(1);
}
process.stdout.write(`Release check passed: ${enforced.length} camera-ready outputs match ${MANIFEST}${withHidden ? " (hidden replays rerun)" : " (hidden replays skipped)"}.\n`);
