import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { currentFrozenHashes } from "./robustness-v02-freeze-lib.mjs";

const workspaceRoot = process.cwd();
const freezePath = path.join(workspaceRoot, "research", "robustness_v02_protocol_freeze.json");
const statePath = path.join(workspaceRoot, "runs", "robustness-v02-confirmatory-state.json");
const runSetPath = path.join(workspaceRoot, "research", "robustness_v02_hidden_run_set.json");
const args = new Set(process.argv.slice(2));
const authorized = args.has("--confirm-hidden");
const freeze = JSON.parse(await readFile(freezePath, "utf8"));

const organizations = freeze.benchmark.organizations;
const regimes = freeze.benchmark.evidenceRegimes;
const checkpoints = freeze.benchmark.evidenceCheckpoints;
const seeds = freeze.confirmatoryMatrix.trialSeeds;
const concurrency = freeze.confirmatoryMatrix.concurrency;
const perAttemptCapUsd = freeze.budget.perAttemptAttributedCostLimitUsd;
const maxAttempts = freeze.confirmatoryMatrix.maximumInfrastructureAttemptsPerUnit;
const globalNewCostLimitUsd = freeze.budget.globalNewProviderCostLimitUsd;

const units = seeds.flatMap((seed) =>
  organizations.flatMap((organization) =>
    regimes.flatMap((regime) =>
      checkpoints.map((checkpoint) => ({ organization, regime, checkpoint, seed })),
    ),
  ),
);
const unitKey = (unit) =>
  [unit.organization, unit.regime, unit.checkpoint, unit.seed].join(":");

if (!authorized) {
  process.stdout.write(`${JSON.stringify({
    status: "dry-run-only",
    frozenStatus: freeze.status,
    plannedUnits: units.length,
    maximumProviderCostReservationUsd: units.length * maxAttempts * perAttemptCapUsd,
    instruction: "Pass --confirm-hidden only under the recorded human authorization.",
  }, null, 2)}\n`);
  process.exit(0);
}
if (freeze.status !== "human_authorized_for_hidden") {
  throw new Error("The v0.2 freeze is not authorized for hidden evaluation.");
}
if (units.length * maxAttempts * perAttemptCapUsd > globalNewCostLimitUsd) {
  throw new Error("The worst-case retry reservation exceeds the frozen global budget.");
}

const currentHashes = await currentFrozenHashes(workspaceRoot);
for (const [name, frozenHash] of Object.entries(freeze.hashes)) {
  if (currentHashes[name] !== frozenHash) {
    throw new Error(`Frozen hash mismatch for ${name}.`);
  }
}

await mkdir(path.dirname(statePath), { recursive: true });
let state;
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  state = {
    schemaVersion: 1,
    benchmarkId: freeze.benchmark.id,
    hashes: freeze.hashes,
    billableCostUsd: 0,
    completed: {},
    infrastructureFailures: [],
  };
}
if (
  state.benchmarkId !== freeze.benchmark.id ||
  JSON.stringify(state.hashes) !== JSON.stringify(freeze.hashes)
) {
  throw new Error("Existing confirmatory state does not match the frozen protocol.");
}

async function saveState() {
  const temporaryPath = `${statePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}

function runAttempt(unit) {
  const childArgs = [
    "dist/robustness-v02.js",
    "--provider", freeze.model.provider,
    "--model", freeze.model.id,
    "--org", unit.organization,
    "--regime", unit.regime,
    "--checkpoint", String(unit.checkpoint),
    "--seed", String(unit.seed),
    "--evaluation", "hidden",
    "--allow-hidden",
    "--max-cost-usd", String(perAttemptCapUsd),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      let result;
      try {
        result = JSON.parse(stdout);
      } catch (error) {
        reject(new Error(`${unitKey(unit)} emitted invalid JSON (${code}): ${stderr || stdout}`));
        return;
      }
      if (code !== 0 && !(code === 2 && result.runStatus === "infrastructure_failure")) {
        reject(new Error(`${unitKey(unit)} failed (${code}): ${stderr || stdout}`));
        return;
      }
      resolve(result);
    });
  });
}

async function runWithInfrastructureRetries(unit) {
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runAttempt(unit);
    attempts.push({
      attempt,
      runId: result.runId,
      runStatus: result.runStatus,
      providerCalls: result.providerCalls,
      billableCostUsd: Number(result.billableCostUsd ?? 0),
    });
    if (result.runStatus === "valid") return { status: "valid", result, attempts };
  }
  return { status: "infrastructure_failure", attempts };
}

const pending = units.filter((unit) => !state.completed[unitKey(unit)]);
for (let offset = 0; offset < pending.length; offset += concurrency) {
  const batch = pending.slice(offset, offset + concurrency);
  const settled = await Promise.allSettled(batch.map(runWithInfrastructureRetries));
  let fatalError;
  settled.forEach((outcome, index) => {
    const unit = batch[index];
    const key = unitKey(unit);
    if (outcome.status === "rejected") {
      fatalError ??= new Error(`${key}: ${outcome.reason.message}`);
      return;
    }
    for (const attempt of outcome.value.attempts) {
      state.billableCostUsd += attempt.billableCostUsd;
      if (attempt.runStatus !== "valid") {
        state.infrastructureFailures.push({ key, ...attempt });
      }
    }
    if (outcome.value.status !== "valid") {
      fatalError ??= new Error(`${key} exhausted infrastructure retries.`);
      return;
    }
    state.completed[key] = {
      runId: outcome.value.result.runId,
      providerCalls: outcome.value.result.providerCalls,
      billableCostUsd: outcome.value.attempts.reduce(
        (sum, attempt) => sum + attempt.billableCostUsd,
        0,
      ),
      attempts: outcome.value.attempts.length,
    };
  });
  await saveState();
  const completedCount = Object.keys(state.completed).length;
  process.stdout.write(
    `[${completedCount}/${units.length}] hidden units; ` +
    `provider cost=$${state.billableCostUsd.toFixed(6)}; ` +
    `infra retries=${state.infrastructureFailures.length}\n`,
  );
  if (state.billableCostUsd > globalNewCostLimitUsd) {
    throw new Error("Frozen global new-provider-cost ceiling exceeded.");
  }
  if (fatalError) throw fatalError;
}

const runIds = units.map((unit) => state.completed[unitKey(unit)]?.runId);
if (runIds.some((runId) => !runId)) throw new Error("Confirmatory matrix is incomplete.");
await writeFile(runSetPath, `${JSON.stringify({
  schemaVersion: 1,
  label: "robustness-v0.2-confirmatory-hidden",
  benchmarkId: freeze.benchmark.id,
  evaluationSplit: "hidden",
  organizations,
  evidenceRegimes: regimes,
  checkpoints,
  trialSeeds: seeds,
  runIds,
  scientificStatus: "confirmatory-hidden-aggregate",
}, null, 2)}\n`, "utf8");

process.stdout.write(`${JSON.stringify({
  status: "complete",
  plannedUnits: units.length,
  completedUnits: Object.keys(state.completed).length,
  billableCostUsd: state.billableCostUsd,
  infrastructureFailureAttempts: state.infrastructureFailures.length,
  statePath,
  runSetPath,
}, null, 2)}\n`);
