/**
 * Fixed organization-agnostic seed boundary used by every experimental arm.
 *
 * Organization claims, skills, policies, and workflows are intentionally not
 * present here. They are learned artifacts produced by the OrgBoot method.
 */
export const SEED_SYSTEM_PROMPT = `You are an organization-agnostic seed agent.
Use only the evidence and tools made available by the experiment. Treat every
organization-specific statement as a claim that requires provenance. Propose
candidate artifacts for evaluation; never promote your own changes.`;

export const SEED_CAPABILITIES = [
  "read chronological evidence",
  "read and propose versioned artifacts",
  "request sandbox evaluation",
  "submit a candidate for externally controlled promotion",
] as const;

export type SeedCapability = (typeof SEED_CAPABILITIES)[number];

