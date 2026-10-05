# Erratum — benchmark.id bookkeeping strings in three stress-arm freeze records

Recorded 2026-08-26, after the v0.5g/v0.5bg hidden runs completed and their
audits first executed.

## The error

Three freeze records carry an erroneous `benchmark.id` bookkeeping string:

| Freeze record | Recorded `benchmark.id` | Actual frozen `BENCHMARK_ID` |
|---|---|---|
| `robustness_v05b_stress_protocol_freeze.json` | `...-stress-v0.5b` | `...-stress-v0.5` |
| `robustness_v05g_stress_protocol_freeze.json` | `...-stress-v0.5-gemini` | `...-stress-v0.5` |
| `robustness_v05bg_stress_protocol_freeze.json` | `...-stress-v0.5b-gemini` | `...-stress-v0.5` |

The stress benchmarks intentionally inherit the v0.5 benchmark file's
identifier: v0.5b changes panel composition but was authored as a sibling of
v0.5's file, and the two Gemini arms inherit their DeepSeek counterparts
byte-identically (a protocol requirement). The freeze-authoring scripts
wrote aspirational arm names into `benchmark.id` instead of the string the
frozen file actually exports. Every run manifest records the actual
exported identifier, so the frozen `audit.mjs` — which compares
`manifest.benchmarkId` to `freeze.benchmark.id` — fails on these three arms
even though every cryptographic check passes.

## Why the science is unaffected

Benchmark identity is established by the `benchmarkAllRegimes` hash, not the
label: each arm's freeze hashes its actual benchmark file, every run
manifest carries that hash, and the audits verify the chain. The two Gemini
freezes record benchmark hashes byte-equal to their DeepSeek counterparts,
which is the byte-identity the protocols require. No prompt, panel, gate,
seed, or analysis is affected; the erroneous field is a display string.

## Handling

The frozen `audit.mjs` files cannot be edited (each arm's
implementation-directory hash is frozen), so corrected copies live in
`scripts/audit-v05b-stress.mjs`, `scripts/audit-v05g-stress.mjs`, and
`scripts/audit-v05bg-stress.mjs`, identical except that the benchmark-id
expectation is the string the frozen benchmark files actually export; all
hash checks are unchanged. The freeze records themselves are preserved
unmodified, erroneous field included, and this erratum is the record of the
discrepancy. The v0.5 arm's freeze has no such error and its audit ran
unmodified.
