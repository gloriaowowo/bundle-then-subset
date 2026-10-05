import { readFile } from "node:fs/promises";
import path from "node:path";

import { fileSha256, currentFrozenHashes } from "./robustness-v02-freeze-lib.mjs";

const workspaceRoot = process.cwd();
const hashes = await currentFrozenHashes(workspaceRoot);
const packageJson = JSON.parse(await readFile(path.join(workspaceRoot, "package.json"), "utf8"));
const freeze = {
  schemaVersion: 1,
  status: "human_authorized_for_hidden",
  frozenAt: "2026-08-21 America/Los_Angeles",
  authorizedAt: "2026-08-21 America/Los_Angeles",
  authorizationMessage: "[redacted for the public release; see ERRATA.md]",
  benchmark: {
    id: "orgboot-synth-robustness-v0.2",
    organizations: [
      "support-orion", "support-beacon", "support-harbor", "support-cedar",
      "procurement-delta", "procurement-mesa", "procurement-apex", "procurement-grove",
    ],
    evidenceRegimes: ["gap-0", "gap-1", "gap-2", "gap-3"],
    evidenceCheckpoints: [0, 8, 16, 24, 32],
    developmentTasksPerOrganization: 8,
    supportHiddenTasksPerOrganization: 13,
    procurementHiddenTasksPerOrganization: 12,
    hiddenTaskCountAcrossOrganizations: 100,
    developmentHiddenScenarioOverlap: 0,
  },
  model: {
    provider: "deepseek",
    id: "deepseek-v4-pro",
    temperature: 0,
    jsonMode: true,
    thinking: "disabled",
    providerRetries: 0,
    adaptationCallsPerAttempt: 2,
    taskInferenceCalls: 0,
  },
  confirmatoryMatrix: {
    trialSeeds: [101, 202, 303],
    unitCount: 480,
    concurrency: 8,
    maximumInfrastructureAttemptsPerUnit: 3,
  },
  analysis: {
    primaryMetric: "normalized trapezoidal safety-constrained VAC AUC",
    hypotheses: ["H1", "H2", "H3", "H4"],
    bootstrapUnit: "organization cluster",
    bootstrapReplicates: 10000,
    bootstrapSeed: 20260822,
    populationInferenceClaimed: false,
  },
  budget: {
    perAttemptAttributedCostLimitUsd: 0.01,
    globalNewProviderCostLimitUsd: 20,
    userTotalExperimentCeilingUsd: 50,
    maximumRetryReservationUsd: 14.4,
  },
  runtime: {
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    piAiPackage: packageJson.dependencies["@earendil-works/pi-ai"],
    piAgentCorePackage: packageJson.dependencies["@earendil-works/pi-agent-core"],
  },
  hashes,
  developmentEvidence: {
    runSet: await fileSha256(path.join(workspaceRoot, "research", "robustness_v02_development_run_set.json")),
    summary: await fileSha256(path.join(workspaceRoot, "research", "robustness_v02_development_summary.json")),
    scientificStatus: "exploratory-development-only",
  },
  secrets: "No API credential is recorded in this file.",
};
process.stdout.write(`${JSON.stringify(freeze, null, 2)}\n`);
