# Robustness v0.5 — Verifier Blind-Spot Stress Arm

Status: prospective stress design; frozen before any provider call for this
arm; authorized by the coauthor in the 2026-08-26 session ("#4能做直接就做").
Benchmark: `enterprise-rsi-verifier-blindspot-stress-v0.5`.

## Question and motivation

In v0.3 the eight-case development verifier was representative enough that
Safe-Subset's 112 accepted-bundle prunings happened not to alter hidden
coverage, so the over-pruning harm diagnosed in v0.2 did not recur in the
confirmation. The authors judged this the study's weakest [line edited; see ERRATA.md]
link: the harm exists in discovery evidence and in post-hoc verifier-mask
replays, but no prospective experiment yet targets it. v0.5 supplies that
experiment by *designing* the verifier blind spot instead of finding it.

## Design

Six fresh organizations (three expense-reimbursement, three
access-provisioning; new identifiers, parameters, and vocabulary skins; the
same 32-item evidence template and rule vocabulary as v0.3). One evidence
regime (gap-0), checkpoints [0, 8, 16, 24, 32], trial seeds [401, 502, 603]:
6 x 1 x 5 x 3 = 90 update units, all four gates per unit.

The single designed manipulation is the composition of the task panels:

- **Blind development panel** (8 cases): seven automatic-outcome cases across
  both tiers plus one ineligible escalation case. **No development case
  requires manager approval**, so a candidate's approval-obligation rule is
  invisible to every release gate.
- **Approval-rich hidden panel** (12--13 cases): six approval-outcome cases
  per organization plus automatic and escalation cases. Development and
  hidden panels remain scenario-disjoint.

Everything else — DSL, prompts, updater contract (one proposal plus at most
one static repair), gates, whole-bundle Lease semantics, metrics, the 13-class
outcome taxonomy, audit machinery — is inherited unchanged from the v0.3
implementation (verbatim module copy in `experiments/v05_stress/`, hashed by
this arm's freeze).

## Frozen predictions

- **P1 (pruning).** In accepted-bundle units whose candidate encodes the
  approval obligation, Safe-Subset's fewer-rules tie-break prunes the
  approval rule: a subset without it passes the blind panel identically.
- **P2 (hidden harm).** Hidden safety-constrained coverage under Safe-Subset
  falls below Bundle and BTS, concentrated on approval-outcome hidden tasks;
  Bundle and BTS remain equal because BTS preserves accepted bundles.
- **P3 (benign failure shape).** The pruning harm is lost coverage, not
  unsafe action: approval-outcome tasks under the pruned artifact abstain
  (no rule matches), so policy-violation exposure stays zero.

A zero-provider oracle validation (frozen in this arm's validation receipt)
already proves the mechanism at the oracle level: subset search on the oracle
candidate prunes exactly `approval-required`, and hidden coverage drops by
exactly the approval-task share with zero policy failures. The model
experiment measures whether *generated* candidates (i) encode the approval
obligation at all and (ii) traverse the same mechanism. Failure of (i) —
models that never learn the approval rule — is itself reportable and bounds
the mechanism's reach.

## Interpretation boundary

The blind spot is designed, so v0.5 estimates no population rate of verifier
blindness; it demonstrates the mechanism prospectively under a frozen,
plausible blindness (an under-tested approval path) and quantifies its
consequence for the release operators. The approval-rich hidden panel is a
stress split and is not comparable to v0.3's hidden composition.

## Model and budget

Model: to be fixed in the freeze record before execution (primary preference:
DeepSeek V4 Pro with the exact v0.3 configuration, for primary-model
continuity; fallback: google/gemini-3.7-flash with the v0.3b compatibility
configuration, executed only after the v0.3b hidden matrix completes to avoid
capacity contention). Per-attempt cap USD 0.015; global v0.5 provider cap
USD 5. Development mode (two organizations) validates contracts before the
frozen 90-unit matrix runs.
