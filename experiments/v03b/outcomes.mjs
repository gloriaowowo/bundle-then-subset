import { gradeTrace } from "../../dist/eval/grader.js";
import {
  safetyConstrainedVac,
  verifiedAutomationCoverage,
} from "../../dist/eval/metrics.js";
import { fallbackAbstentionWorkflow } from "../../dist/methods/artifacts.js";
import { executeWorkflow } from "../../dist/simulator/workflow.js";

export const OUTCOME_CLASSES = [
  "no_candidate",
  "gate_abstention",
  "no_rule_match",
  "explicit_abstention",
  "escalation_correct",
  "escalation_incorrect",
  "approval_correct",
  "approval_incorrect",
  "action_success",
  "action_policy_failure",
  "action_functional_failure",
  "grounding_failure",
  "response_only",
];

function emptyOutcomeCounts() {
  return Object.fromEntries(OUTCOME_CLASSES.map((name) => [name, 0]));
}

function classifyOutcome(candidate, activeWorkflow, execution, grade) {
  if (!candidate) return "no_candidate";
  if (!activeWorkflow) return "gate_abstention";
  if (!grade.groundingPass) return "grounding_failure";
  if (!execution.matchedRuleId) return "no_rule_match";

  const events = execution.trace.events;
  if (events.some((event) => event.kind === "abstention")) return "explicit_abstention";
  if (events.some((event) => event.kind === "escalation")) {
    return grade.functionalPass && grade.policyPass ? "escalation_correct" : "escalation_incorrect";
  }
  if (events.some((event) => event.kind === "approval")) {
    return grade.functionalPass && grade.policyPass ? "approval_correct" : "approval_incorrect";
  }
  if (events.some((event) => event.kind === "tool")) {
    if (!grade.policyPass) return "action_policy_failure";
    return grade.functionalPass ? "action_success" : "action_functional_failure";
  }
  return "response_only";
}

function meanBoolean(grades, key) {
  if (grades.length === 0) return 0;
  return grades.filter((grade) => grade[key] === true).length / grades.length;
}

function summarizeResults(results) {
  const grades = results.map((result) => result.grade);
  const outcomeCounts = emptyOutcomeCounts();
  for (const result of results) outcomeCounts[result.outcome] += 1;
  const taskCount = grades.length;
  return {
    taskCount,
    verifiedAutomationCoverage: verifiedAutomationCoverage(grades),
    safetyConstrainedVac: safetyConstrainedVac(grades),
    functionalPassRate: meanBoolean(grades, "functionalPass"),
    policyPassRate: meanBoolean(grades, "policyPass"),
    groundingPassRate: meanBoolean(grades, "groundingPass"),
    policyFailureCount: grades.filter((grade) => !grade.policyPass).length,
    groundingFailureCount: grades.filter((grade) => !grade.groundingPass).length,
    outcomeCounts,
    outcomeRates: Object.fromEntries(
      Object.entries(outcomeCounts).map(([name, count]) => [name, taskCount === 0 ? 0 : count / taskCount]),
    ),
  };
}

export function evaluateWorkflowAggregate({
  candidate,
  activeWorkflow,
  tasks,
  visibleEvidence,
  tools,
  idSuffix,
}) {
  const knownEvidence = new Set(visibleEvidence.map((item) => item.id));
  const results = tasks.map((task) => {
    const workflow = activeWorkflow ?? fallbackAbstentionWorkflow(task, visibleEvidence, idSuffix);
    const execution = executeWorkflow(workflow, task, tools);
    const grade = gradeTrace(task, execution.trace, execution.finalState, workflow, knownEvidence);
    return {
      category: task.category,
      grade,
      outcome: classifyOutcome(candidate, activeWorkflow, execution, grade),
    };
  });
  const categories = [...new Set(results.map((result) => result.category))];
  return {
    ...summarizeResults(results),
    byCategory: Object.fromEntries(categories.map((category) => [
      category,
      summarizeResults(results.filter((result) => result.category === category)),
    ])),
  };
}

