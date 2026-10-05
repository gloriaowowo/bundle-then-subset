import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { hashArtifact } from "../dist/eval/manifest.js";
import {
  createRobustnessOrganizations,
  EVIDENCE_GAP_REGIMES,
} from "../dist/generator/robustness.js";
import { WORKFLOW_SYSTEM_PROMPT } from "../dist/methods/prompts.js";

export async function fileSha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

export async function implementationHash(workspaceRoot) {
  const sourceRoot = path.join(workspaceRoot, "src");
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(absolute);
    }
  }
  await visit(sourceRoot);
  const records = await Promise.all(files.sort().map(async (absolute) => ({
    path: path.relative(workspaceRoot, absolute),
    content: await readFile(absolute, "utf8"),
  })));
  return hashArtifact({ files: records });
}

export function benchmarkHash() {
  return hashArtifact({
    regimes: EVIDENCE_GAP_REGIMES.map((regime) => ({
      regime,
      organizations: createRobustnessOrganizations(regime).map((organization) => ({
        id: organization.id,
        domain: organization.domain,
        evidence: organization.evidence,
        developmentTasks: organization.developmentTasks,
        hiddenTasks: organization.hiddenTasks,
        oracleWorkflow: organization.oracleWorkflow,
        toolNames: [...organization.tools.keys()].sort(),
      })),
    })),
  });
}

export function promptContractHash() {
  return hashArtifact({ workflowSystemPrompt: WORKFLOW_SYSTEM_PROMPT });
}

export async function currentFrozenHashes(workspaceRoot) {
  const relative = (value) => path.join(workspaceRoot, value);
  return {
    implementationAllTypescriptUnderSrc: await implementationHash(workspaceRoot),
    benchmarkAllRegimes: benchmarkHash(),
    promptContract: promptContractHash(),
    protocol: await fileSha256(relative("research/robustness_v02_protocol.md")),
    analysis: await fileSha256(relative("src/summarize-robustness.ts")),
    confirmatoryOrchestrator: await fileSha256(relative("scripts/run-robustness-confirmatory.mjs")),
    freezeLibrary: await fileSha256(relative("scripts/robustness-v02-freeze-lib.mjs")),
    packageJson: await fileSha256(relative("package.json")),
    packageLock: await fileSha256(relative("package-lock.json")),
  };
}
