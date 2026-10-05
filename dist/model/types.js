/** Provider failures may still be billable and must reach the budget ledger. */
export class ModelBackendError extends Error {
    usage;
    constructor(message, usage) {
        super(message);
        this.usage = usage;
        this.name = "ModelBackendError";
    }
}
//# sourceMappingURL=types.js.map