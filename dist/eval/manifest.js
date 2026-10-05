import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
function canonicalize(value) {
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
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
        .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
        .join(",")}}`;
}
export function hashArtifact(value) {
    return createHash("sha256").update(canonicalize(value)).digest("hex");
}
export async function writeRunManifest(workspaceRoot, manifest) {
    if (!/^[a-zA-Z0-9._-]+$/.test(manifest.runId)) {
        throw new Error("runId contains unsupported path characters.");
    }
    const runDirectory = path.join(workspaceRoot, "runs", manifest.runId);
    await mkdir(runDirectory, { recursive: true });
    const manifestPath = path.join(runDirectory, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return manifestPath;
}
//# sourceMappingURL=manifest.js.map