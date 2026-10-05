# Robustness v0.5b — Second Verifier Blind Spot (Escalation), Stress Arm

Status: prospective stress design; frozen before any provider call for this
arm; authorized under the coauthor's standing stress-arm directive
("#4能做直接就做", extended to the multi-weakness stability plan, 2026-08-26
session). Benchmark: identical latent organizations, evidence, DSL, prompts,
gates, metrics, and model configuration as v0.5; only the task-panel
composition changes.

## Question

v0.5 designed one verifier blind spot (no approval-outcome development case)
and observed complete, exactly-attributable pruning of the blind behavior.
v0.5b asks whether the mechanism is specific to that stratum by designing a
different blindness: the development panel contains no ineligible case, so the
eligibility/escalation rule is verifier-invisible, while approval cases are
now fully visible. Hidden panels contain every ineligible case (three per
organization).

## Design deltas from v0.5 (exhaustive)

1. Development indices [0, 1, 2, 4, 5, 8, 13, 16]: eight eligible cases
   spanning both tiers including both approval cases; no ineligible case.
2. Hidden panels include all three ineligible specs per organization
   (escalation share 3/13 expense, 3/12 access) and remain scenario-disjoint
   from development.
3. Everything else is inherited byte-identically, including the six v0.5
   organizations and the benchmark identifier (prompt-byte identity).

## Frozen predictions

- **P1'** In accepted-bundle units whose candidate encodes the eligibility
  obligation, exact subset search prunes the escalation rule.
- **P2'** Hidden coverage under Safe-Subset falls below Bundle and BTS,
  concentrated on escalation-outcome hidden tasks; BTS equals Bundle in every
  accepted unit.
- **P3'** The exposure shape depends on whether the retained tier rules gate
  on the eligibility field. If they do (as the oracle does and as
  evidence-complete candidates are expected to), pruning yields no-rule-match
  abstention and zero violation exposure. If a candidate's tier rules omit
  the eligibility guard, the pruned artifact auto-executes ineligible
  requests and Safe-Subset becomes the violating gate. We predict the benign
  shape at evidence-complete checkpoints and commit to reporting whichever
  occurs.

A zero-provider oracle validation (this arm's validation receipt) already
proves the mechanism at the oracle level: subset search prunes exactly
`ineligible`, and hidden coverage drops by exactly the escalation-task share
with zero policy failures.

## Candidate sharing with v0.5 (paired design)

Because the organizations, evidence, prompts, and model configuration are
byte-identical to v0.5, the deterministic response cache resolves every
generation request to the v0.5 response: v0.5b evaluates the same generated
candidates (verified by matching candidate hashes) under a different verifier
composition, at zero marginal provider cost. This makes v0.5 and v0.5b a
paired comparison across designed blind spots---differences between the two
arms are attributable to the panel design alone, with no between-arm sampling
noise---and it is disclosed here rather than presented as fresh sampling.
Predictions P1'--P3' were frozen before any v0.5b gate or hidden evaluation
was computed.

## Model and budget

DeepSeek V4 Pro, the exact v0.3/v0.5 configuration. Per-attempt cap USD
0.015; global v0.5b cap USD 5. Development mode (two organizations) validates
contracts before the frozen 90-unit matrix.
