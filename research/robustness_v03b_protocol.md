# Robustness v0.3b — Gemini Cross-Model Arm, Provider-Compatibility Successor

Status: successor protocol to the frozen v0.3 cross-model replication arm;
authorized by the coauthor in the 2026-08-26 session after billing was enabled
("billing开好了 跑吧").

## Why a successor exists

The v0.3 freeze (2026-08-22T06:54:30Z) prespecified a cross-model replication
arm: Google `gemini-3.7-flash`, temperature 0, JSON mode, reasoning off,
"subject to credential availability", with a model-stratified pooled estimate
mandatory if completed. Two facts prevented the arm from running as frozen:

1. On 2026-08-22 the credential was unavailable (three run directories from
   06:52--06:53 predate the freeze and record the abandoned attempt).
2. On 2026-08-26, with a paid credential, a full 40-unit v0.3 development run
   completed with **0/32 generated candidates**: every provider call returned
   HTTP 400 --- "Thinking level MINIMAL is not supported for this model."
   The frozen reasoning-off configuration is not accepted by this provider
   for this model. Run set:
   `research/robustness_v03_google-gemini-3.7-flash_development_run_set.json`.

## Transport-policy fixes (infrastructure, not scientific content)

The first v0.3b development run (2026-08-26) surfaced Google-specific
capacity errors: 12 of 32 generating units failed solely on HTTP 503
"high demand" responses, which the v0.3 error classifier — written against
DeepSeek's error surface — mis-labeled as scientific rejections. v0.3b
therefore also carries four transport-layer fixes, none of which touch
prompts, scoring, gates, or analysis: (1) 503/UNAVAILABLE/high-demand
responses are classified as infrastructure failures, as the protocol's own
retry rule intends; (2) a 20-second backoff precedes an infrastructure
retry; (3) development mode allows three attempts per unit (hidden keeps
the frozen two, respecting the frozen per-attempt and reservation caps);
(4) hidden concurrency is reduced from six to four to lower capacity-error
pressure. Run IDs and labels carry a `v03b` namespace.

## The single scientific change

v0.3b executes the same prespecified arm with one technically required
deviation: the Google arm uses reasoning level `low`, the lowest level the
provider accepts for this model (verified by a one-call probe on 2026-08-26).
All other elements are inherited byte-identically from v0.3: system prompt,
prompt contract, benchmark and organizations, gates, the 8 x 4 x 5 x 3 = 480-unit
confirmatory matrix, trial seeds [401, 502, 603], per-attempt and global cost
caps, the analysis plan (H1--H3, organization-cluster bootstrap, seed 20260823),
and the reporting rule (report separately first; model-stratified pooled
estimate mandatory if completed). The implementation copy lives in
`experiments/v03b/` and differs from `experiments/v03/` only in bookkeeping
names, the freeze reference, and the one-line provider-conditional reasoning
level; the v0.3b freeze hashes the v0.3b implementation.

## What this deviation means for interpretation

Reasoning level is part of the serving configuration, so the Gemini arm is a
cross-model AND cross-thinking-configuration comparison, not a pure model swap.
This must be stated wherever the arm is reported. The completed v0.3 DeepSeek
confirmatory evidence is immutable and is not touched by this successor.

## Execution order

development (contract validation; stop if structured-output validity is too
low) -> freeze verification -> hidden with `--confirm-hidden` under this
successor's freeze record.
