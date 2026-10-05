# v0.4 post-hoc robustness protocol

Status: **post-hoc stress test and descriptive sensitivity analysis**. This is not a new confirmatory phase. The v0.3 hidden aggregate had already been inspected before this protocol was written.

## Frozen inputs

- Use the immutable v0.3 DeepSeek hidden run set and its stored workflow candidates.
- Reconstruct development and hidden tasks deterministically from the frozen v0.3 benchmark.
- Make no model calls and do not alter v0.2 or v0.3 implementation, benchmark, prompt, protocol, run, or audit artifacts.
- Persist aggregate results only. Do not persist hidden task identifiers, traces, grades, or failure strings.

## Stress question

The full eight-case verifier perfectly separates hidden-safe/useful from hidden-unsafe/useless generated candidates in the observed v0.3 run. How do Bundle, Safe-Subset, and Bundle-then-Subset behave when that verifier is incomplete?

This test estimates sensitivity to the **finite verifier used in this synthetic benchmark**. It does not estimate production safety or a population-level verifier coverage curve.

## Intervention

The eight frozen development cases are assigned fixed positions D1--D8. For every nonempty subset of these positions (255 masks), apply each release gate to the same stored candidate and evaluate the resulting artifact on the unchanged scenario-disjoint hidden cases.

For each verifier size `k = 1..8`, average uniformly over all `choose(8, k)` masks. No mask is selected using hidden performance. Report each leave-one-case-out mask separately.

The gates are:

1. Direct: deploy the complete statically valid candidate; verifier-independent reference.
2. Bundle: deploy the complete candidate only when the selected verifier subset reports no policy or grounding failure and at least one automated pass.
3. Safe-Subset: search all nonempty workflow-rule subsets against the selected verifier subset.
4. Bundle-then-Subset (BTS): preserve a Bundle-accepted candidate; otherwise use the same Safe-Subset result.

## Outcomes

Primary descriptive curves by verifier size and gate:

- safety-constrained verified-automation-coverage AUC (SC-VAC AUC),
- raw VAC AUC,
- policy-violation-exposure AUC,
- complete-evidence raw VAC, SC-VAC, and violation exposure.

Diagnostics:

- verifier acceptance versus Direct hidden-safe/useful status among generated candidates,
- false-positive and false-negative counts and rates,
- Bundle, Safe-Subset, and BTS route rates,
- leave-one-development-case-out gate metrics,
- BTS minus Bundle and BTS minus Safe-Subset differences.

Acquisition AUC is the normalized trapezoidal area over evidence fractions `0, .25, .5, .75, 1`. The unit of descriptive averaging is an organization/regime/trial/verifier-mask acquisition series. Each verifier size weights its masks uniformly. Organization-level means are retained so readers can see heterogeneity; inferential p-values are not used for the post-hoc stress curves.

## Existing-data additions

Two analyses reuse the unchanged v0.3 aggregates:

- per-organization BTS-minus-Bundle SC-VAC AUC and an exhaustive eight-cluster sign-flip sensitivity calculation;
- rescue anatomy over nonzero-checkpoint units routed through `subset_recovery`, contrasting Bundle abstention with BTS's mutually exclusive hidden outcome classes.

These analyses are labeled post-hoc. The sign-flip result is a small-cluster sensitivity check, not a substitute for more organizations.

## Interpretation guardrails

- A v0.3 tie between BTS and Safe-Subset is reported explicitly.
- BTS is not called universally weakly dominant: it inherits verifier false acceptances by construction.
- Zero observed violation under the full verifier is benchmark-conditional.
- Evidence-timing domain splits remain post-hoc with four organizations per domain and support only the negative conclusion that a conservative model default is unreliable across domains.
