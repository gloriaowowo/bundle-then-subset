import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RunManifest } from "./manifest.js";

export type ClaimStatus =
  | "planned"
  | "supported"
  | "inconclusive"
  | "contradicted";

export interface ClaimRunEvidence {
  runId: string;
  metric: string;
  note?: string;
}

export interface ClaimLedgerEntry {
  id: string;
  statement: string;
  status: ClaimStatus;
  evidence: ClaimRunEvidence[];
  limitations: string[];
}

export interface ClaimLedger {
  schemaVersion: 1;
  benchmarkId: string;
  updatedAt: string;
  entries: ClaimLedgerEntry[];
}

export interface ClaimLedgerValidation {
  valid: boolean;
  errors: string[];
}

export function validateClaimLedger(
  ledger: ClaimLedger,
  manifests: ReadonlyMap<string, RunManifest>,
): ClaimLedgerValidation {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const entry of ledger.entries) {
    if (ids.has(entry.id)) {
      errors.push(`duplicate claim id ${entry.id}`);
    }
    ids.add(entry.id);

    if (entry.status !== "planned" && entry.evidence.length === 0) {
      errors.push(`claim ${entry.id} is ${entry.status} without run evidence`);
    }
    if (entry.status === "supported" && entry.limitations.length === 0) {
      errors.push(`supported claim ${entry.id} has no stated limitations`);
    }

    for (const reference of entry.evidence) {
      const manifest = manifests.get(reference.runId);
      if (!manifest) {
        errors.push(`claim ${entry.id} cites missing run ${reference.runId}`);
        continue;
      }
      if (manifest.benchmarkId !== ledger.benchmarkId) {
        errors.push(
          `claim ${entry.id} cites run ${reference.runId} from benchmark ${manifest.benchmarkId}`,
        );
      }
      if (!(reference.metric in manifest.metrics)) {
        errors.push(
          `claim ${entry.id} cites missing metric ${reference.metric} in run ${reference.runId}`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function writeClaimLedgerSnapshot(
  workspaceRoot: string,
  runId: string,
  ledger: ClaimLedger,
): Promise<string> {
  if (!/^[a-zA-Z0-9._-]+$/.test(runId)) {
    throw new Error("runId contains unsupported path characters.");
  }
  const runDirectory = path.join(workspaceRoot, "runs", runId);
  await mkdir(runDirectory, { recursive: true });
  const ledgerPath = path.join(runDirectory, "claims.json");
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  return ledgerPath;
}
