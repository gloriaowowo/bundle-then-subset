import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { JsonValue } from "../domain/types.js";

export interface RunManifest {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  benchmarkId: string;
  method: string;
  model: {
    provider: string;
    id: string;
    temperature: number;
  };
  hashes: Record<string, string>;
  metrics: Record<string, number>;
  modelCalls: number;
  modelRequestMade: boolean;
  notes: string[];
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error("Cannot hash a value containing undefined.");
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
}

export function hashArtifact(value: JsonValue | object): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

export async function writeRunManifest(
  workspaceRoot: string,
  manifest: RunManifest,
): Promise<string> {
  if (!/^[a-zA-Z0-9._-]+$/.test(manifest.runId)) {
    throw new Error("runId contains unsupported path characters.");
  }
  const runDirectory = path.join(workspaceRoot, "runs", manifest.runId);
  await mkdir(runDirectory, { recursive: true });
  const manifestPath = path.join(runDirectory, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}
