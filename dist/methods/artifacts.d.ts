import type { EvidenceItem, OrganizationClaim, TaskCase, WorkflowArtifact } from "../domain/types.js";
export declare function parseOrganizationClaims(value: unknown, knownEvidence: ReadonlySet<string>, maxClaims?: number): OrganizationClaim[];
export declare function fallbackAbstentionWorkflow(task: TaskCase, evidence: readonly EvidenceItem[], idSuffix: string): WorkflowArtifact;
