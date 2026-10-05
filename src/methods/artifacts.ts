import type {
  EvidenceItem,
  OrganizationClaim,
  TaskCase,
  WorkflowArtifact,
} from "../domain/types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): boolean {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

export function parseOrganizationClaims(
  value: unknown,
  knownEvidence: ReadonlySet<string>,
  maxClaims = 16,
): OrganizationClaim[] {
  if (!isRecord(value) || !Array.isArray(value.claims)) {
    throw new Error("Claim response must be an object containing claims[].");
  }
  if (value.claims.length > maxClaims) {
    throw new Error(`Claim response has ${value.claims.length} claims; maximum is ${maxClaims}.`);
  }
  return value.claims.map((rawClaim, index) => {
    if (!isRecord(rawClaim)) {
      throw new Error(`claims[${index}] must be an object.`);
    }
    const requiredStrings = ["id", "subject", "predicate", "scope"] as const;
    for (const field of requiredStrings) {
      if (typeof rawClaim[field] !== "string" || rawClaim[field].length === 0) {
        throw new Error(`claims[${index}].${field} must be a non-empty string.`);
      }
    }
    if (!isJsonValue(rawClaim.object)) {
      throw new Error(`claims[${index}].object must be JSON.`);
    }
    if (typeof rawClaim.confidence !== "number" || rawClaim.confidence < 0 || rawClaim.confidence > 1) {
      throw new Error(`claims[${index}].confidence must be in [0,1].`);
    }
    if (!Array.isArray(rawClaim.provenance) || rawClaim.provenance.length === 0 || rawClaim.provenance.some((item) => typeof item !== "string" || !knownEvidence.has(item))) {
      throw new Error(`claims[${index}].provenance must cite visible evidence.`);
    }
    if (!new Set(["candidate", "active", "superseded", "rejected"]).has(String(rawClaim.status))) {
      throw new Error(`claims[${index}].status is unsupported.`);
    }
    for (const optionalDate of ["effectiveFrom", "effectiveUntil"] as const) {
      if (rawClaim[optionalDate] !== undefined && typeof rawClaim[optionalDate] !== "string") {
        throw new Error(`claims[${index}].${optionalDate} must be a string.`);
      }
    }
    return structuredClone(rawClaim) as unknown as OrganizationClaim;
  });
}

export function fallbackAbstentionWorkflow(
  task: TaskCase,
  evidence: readonly EvidenceItem[],
  idSuffix: string,
): WorkflowArtifact {
  const provenance = evidence.length > 0 ? [evidence[evidence.length - 1]!.id] : [];
  return {
    id: `${task.organizationId}-${idSuffix}-abstain`,
    organizationId: task.organizationId,
    taskFamily: task.family,
    version: 1,
    trigger: {
      op: "eq",
      left: { kind: "path", path: "input.taskFamily" },
      right: { kind: "literal", value: task.family },
    },
    rules: [
      {
        id: "insufficient-grounding",
        when: { op: "exists", left: { kind: "path", path: "input.taskFamily" } },
        steps: [{ kind: "abstain", reason: "No validated workflow is available." }],
        provenance,
      },
    ],
    provenance,
    status: "active",
  };
}
