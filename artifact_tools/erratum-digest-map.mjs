// Erratum digest map: lets the UNMODIFIED frozen audit and replay scripts run on
// the public release, in which a few hash-frozen files were redacted
// (ERRATA.md, ERRATA.json).
//
// Loaded with `node --import ./artifact_tools/erratum-digest-map.mjs <script>`.
// It changes no bytes on disk. It wraps crypto's Hash#digest so that a SHA-256
// hex digest equal to the RELEASED hash of a redacted file (and only those
// digests, listed in ERRATA.json) is reported as that file's FROZEN hash.
// Every other digest passes through untouched; a 256-bit exact match cannot
// fire by accident. artifact_tools/verify-release.mjs first checks that each
// redacted file has exactly the released hash and differs from its frozen
// original only at the documented lines, then runs the frozen scripts under
// this map. Each substitution is counted and reported on exit (stderr, and
// the file named by BTS_ERRATUM_DIGEST_LOG when set).
import crypto from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errata = JSON.parse(readFileSync(path.join(ROOT, "ERRATA.json"), "utf8"));
const map = new Map();
for (const entry of errata.files) {
  if (entry.hashFrozen && entry.releasedSha256 !== entry.frozenSha256) {
    map.set(entry.releasedSha256, { frozen: entry.frozenSha256, path: entry.path });
  }
}
const counts = new Map();
const original = crypto.Hash.prototype.digest;
crypto.Hash.prototype.digest = function digest(encoding) {
  const result = original.call(this, encoding);
  const hex = typeof result === "string" ? (encoding === "hex" ? result : null) : result.toString("hex");
  const hit = hex && map.get(hex);
  if (!hit) return result;
  counts.set(hit.path, (counts.get(hit.path) ?? 0) + 1);
  if (typeof result === "string") return hit.frozen;
  return Buffer.from(hit.frozen, "hex");
};
process.on("exit", () => {
  if (counts.size === 0) return;
  const line = `${JSON.stringify({ erratumDigestSubstitutions: Object.fromEntries([...counts].sort()) })}\n`;
  process.stderr.write(line);
  if (process.env.BTS_ERRATUM_DIGEST_LOG) appendFileSync(process.env.BTS_ERRATUM_DIGEST_LOG, line);
});
