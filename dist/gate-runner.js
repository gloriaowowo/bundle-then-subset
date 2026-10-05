import assert from "node:assert/strict";
import { runCheckpoint } from "./eval/runner.js";
import { createBenchmarkOrganizations } from "./generator/benchmark.js";
import { OracleCondition } from "./methods/oracle.js";
const organizations = createBenchmarkOrganizations();
const results = [];
for (const organization of organizations) {
    const result = await runCheckpoint(new OracleCondition(organization.oracleWorkflow), organization, organization.evidence.length, 0);
    assert.equal(result.verifiedAutomationCoverage, 1, organization.id);
    assert.equal(result.state.claims.length, 0);
    assert.equal(result.state.activeWorkflows.length, 1);
    assert.equal(result.state.audit.length, 0);
    results.push(result);
}
console.log(JSON.stringify({
    gate: "condition-runner",
    condition: "C4-oracle",
    experimentalUnits: results.length,
    hiddenTasks: results.reduce((total, result) => total + result.grades.length, 0),
    vacByOrganization: Object.fromEntries(results.map((result) => [
        result.organizationId,
        result.verifiedAutomationCoverage,
    ])),
    modelRequestMade: false,
}, null, 2));
//# sourceMappingURL=gate-runner.js.map