import type { RunManifest } from "./manifest.js";
export type ClaimStatus = "planned" | "supported" | "inconclusive" | "contradicted";
export interface ClaimRunEvidence {
    runId: string;
    metric: string;
    note?: string;
}
export interface ClaimLedgerEntry {
    id: string;
    statement: string;
    status: ClaimStatus;
    evidence: ClaimRunEvidence[];
    limitations: string[];
}
export interface ClaimLedger {
    schemaVersion: 1;
    benchmarkId: string;
    updatedAt: string;
    entries: ClaimLedgerEntry[];
}
export interface ClaimLedgerValidation {
    valid: boolean;
    errors: string[];
}
export declare function validateClaimLedger(ledger: ClaimLedger, manifests: ReadonlyMap<string, RunManifest>): ClaimLedgerValidation;
export declare function writeClaimLedgerSnapshot(workspaceRoot: string, runId: string, ledger: ClaimLedger): Promise<string>;
