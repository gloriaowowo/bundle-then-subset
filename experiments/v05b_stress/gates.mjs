import { applyPromotionGate } from "../../dist/methods/promotion.js";

export const RELEASE_GATES = ["direct", "bundle", "safe-subset", "bundle-then-subset"];

export function applyReleaseGate(candidate, gate, developmentTasks, tools, evidenceIds) {
  if (gate !== "bundle-then-subset") {
    const decision = applyPromotionGate(candidate, gate, developmentTasks, tools, evidenceIds);
    return {
      ...decision,
      route: decision.activeWorkflow ? `${gate}_accepted` : `${gate}_abstained`,
    };
  }

  const bundle = applyPromotionGate(candidate, "bundle", developmentTasks, tools, evidenceIds);
  if (bundle.activeWorkflow) {
    return {
      ...bundle,
      gate,
      route: "bundle_accepted",
      reason: "The complete candidate passed, so hierarchical release preserved it unchanged.",
    };
  }

  const subset = applyPromotionGate(candidate, "safe-subset", developmentTasks, tools, evidenceIds);
  return {
    ...subset,
    gate,
    route: subset.activeWorkflow ? "subset_recovery" : "complete_abstention",
    subsetsEvaluated: bundle.subsetsEvaluated + subset.subsetsEvaluated,
    reason: subset.activeWorkflow
      ? "The complete candidate failed; hierarchical release recovered a safe non-empty subset."
      : "Neither the complete candidate nor a safe useful subset passed the verifier.",
  };
}

