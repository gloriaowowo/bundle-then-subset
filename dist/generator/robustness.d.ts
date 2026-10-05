import type { EvidenceItem } from "../domain/types.js";
import { type BenchmarkOrganization } from "./benchmark.js";
export declare const ROBUSTNESS_BENCHMARK_ID = "orgboot-synth-robustness-v0.2";
export declare const EVIDENCE_GAP_REGIMES: readonly ["gap-0", "gap-1", "gap-2", "gap-3"];
export type EvidenceGapRegime = (typeof EVIDENCE_GAP_REGIMES)[number];
/**
 * Keep the evidence multiset fixed while moving the authoritative current
 * action-limit rule to batch one and the authoritative approval rule zero to
 * three batches later. All other items retain canonical relative order.
 */
export declare function orderEvidenceByAuthoritativeGap(evidence: readonly EvidenceItem[], regime: EvidenceGapRegime): EvidenceItem[];
export declare function createRobustnessOrganizations(regime: EvidenceGapRegime): BenchmarkOrganization[];
export declare function authoritativeGapBatches(regime: EvidenceGapRegime): number;
