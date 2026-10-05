// Shared helpers for the public-release tools. Node.js standard library only.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same canonical JSON as src/eval/manifest.ts (hashArtifact): keys sorted with
// localeCompare, arrays in order, primitives through JSON.stringify.
export function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("Cannot hash undefined.");
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
}

export const hashArtifact = (value) => createHash("sha256").update(canonicalize(value)).digest("hex");
export const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const sha256File = async (file) => sha256Bytes(await readFile(file));
export const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
export const rel = (...parts) => path.join(ROOT, ...parts);

export async function readCanary() {
  const text = await readFile(rel("CANARY.txt"), "utf8");
  const canary = text.split("\n")[0].trim();
  if (!/^BTS-CANARY-[0-9a-f-]{36}$/.test(canary)) throw new Error("CANARY.txt: unexpected first line.");
  return canary;
}

// The directory-hash rule of experiments/*/integrity.mjs and
// scripts/robustness-v02-freeze-lib.mjs: every file with the suffix, sorted,
// as {path, content} records under hashArtifact({files}).
export async function directorySourceHash(directory, suffix, relativeTo = directory) {
  const files = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(absolute);
    }
  }
  await visit(directory);
  const records = await Promise.all(files.sort().map(async (absolute) => ({
    path: path.relative(relativeTo, absolute),
    content: await readFile(absolute, "utf8"),
  })));
  return hashArtifact({ files: records });
}

export async function loadErrata() {
  return readJson(rel("ERRATA.json"));
}

export function erratumFor(errata, file) {
  return errata.files.find((entry) => entry.path === file);
}
