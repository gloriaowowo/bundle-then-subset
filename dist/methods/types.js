export function emptyMethodState(conditionId, organizationId, checkpoint) {
    return {
        conditionId,
        organizationId,
        checkpoint,
        claims: [],
        candidateWorkflows: [],
        activeWorkflows: [],
        audit: [],
    };
}
//# sourceMappingURL=types.js.map