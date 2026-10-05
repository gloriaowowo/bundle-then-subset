import { gradeTrace } from "../../dist/eval/grader.js";
import { executeWorkflow } from "../../dist/simulator/workflow.js";
import { createOrganizations, EVIDENCE_REGIMES } from "./benchmark.mjs";
import { applyReleaseGate } from "./gates.mjs";
import { OUTCOME_CLASSES, evaluateWorkflowAggregate } from "./outcomes.mjs";

let taskCount = 0;
for (const regime of EVIDENCE_REGIMES) {
  const organizations = createOrganizations(regime);
  if (organizations.length !== 8) throw new Error("Expected eight organizations.");
  for (const organization of organizations) {
    if (organization.evidence.length !== 32 || organization.developmentTasks.length !== 8) {
      throw new Error(`${organization.id} has invalid benchmark counts.`);
    }
    const expectedHidden = organization.domain === "expense" ? 13 : 12;
    if (organization.hiddenTasks.length !== expectedHidden) throw new Error("Invalid hidden count.");
    const known = new Set(organization.evidence.map((item) => item.id));
    for (const task of [...organization.developmentTasks, ...organization.hiddenTasks]) {
      const execution = executeWorkflow(organization.oracleWorkflow, task, organization.tools);
      const grade = gradeTrace(
        task,
        execution.trace,
        execution.finalState,
        organization.oracleWorkflow,
        known,
      );
      if (!grade.automatedPass) throw new Error(`${organization.id} oracle failed.`);
      taskCount += 1;
    }
  }
}

const organization = createOrganizations("gap-0")[0];
const evidenceIds = new Set(organization.evidence.map((item) => item.id));
const bundle = applyReleaseGate(
  organization.oracleWorkflow,
  "bundle",
  organization.developmentTasks,
  organization.tools,
  evidenceIds,
);
const hybrid = applyReleaseGate(
  organization.oracleWorkflow,
  "bundle-then-subset",
  organization.developmentTasks,
  organization.tools,
  evidenceIds,
);
if (!bundle.activeWorkflow || hybrid.route !== "bundle_accepted") {
  throw new Error("Hybrid must preserve an accepted complete bundle.");
}
if (JSON.stringify(bundle.activeWorkflow) !== JSON.stringify(hybrid.activeWorkflow)) {
  throw new Error("Hybrid altered an accepted bundle.");
}

const unsafeCandidate = structuredClone(organization.oracleWorkflow);
unsafeCandidate.rules[1].when = {
  op: "eq",
  left: { kind: "path", path: "input.receiptVerified" },
  right: { kind: "literal", value: true },
};
unsafeCandidate.rules[1].provenance = [
  `${organization.id}-limit-v2`,
  `${organization.id}-completion-policy`,
];
const rejectedBundle = applyReleaseGate(
  unsafeCandidate,
  "bundle",
  organization.developmentTasks,
  organization.tools,
  evidenceIds,
);
const recoveredHybrid = applyReleaseGate(
  unsafeCandidate,
  "bundle-then-subset",
  organization.developmentTasks,
  organization.tools,
  evidenceIds,
);
if (rejectedBundle.activeWorkflow || recoveredHybrid.route !== "subset_recovery") {
  throw new Error("Hybrid must invoke subset recovery only after bundle rejection.");
}
const evaluated = evaluateWorkflowAggregate({
  candidate: organization.oracleWorkflow,
  activeWorkflow: hybrid.activeWorkflow,
  tasks: organization.hiddenTasks,
  visibleEvidence: organization.evidence,
  tools: organization.tools,
  idSuffix: "validation",
});
if (evaluated.verifiedAutomationCoverage !== 1 || evaluated.policyFailureCount !== 0) {
  throw new Error("Validated hybrid oracle evaluation failed.");
}
if (
  Object.keys(evaluated.outcomeCounts).length !== OUTCOME_CLASSES.length ||
  Object.values(evaluated.outcomeCounts).reduce((sum, value) => sum + value, 0) !== evaluated.taskCount
) throw new Error("Outcome taxonomy is incomplete or non-exclusive.");

process.stdout.write(`${JSON.stringify({
  status: "valid",
  regimes: EVIDENCE_REGIMES.length,
  organizationsPerRegime: 8,
  oracleTaskEvaluations: taskCount,
  hybridAcceptedBundlePreserved: true,
  hybridRejectedBundleRecovered: true,
  outcomeClasses: OUTCOME_CLASSES.length,
}, null, 2)}\n`);
