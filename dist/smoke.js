import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { SEED_CAPABILITIES, SEED_SYSTEM_PROMPT } from "./seed.js";
const models = createModels();
const agent = new Agent({
    initialState: {
        systemPrompt: SEED_SYSTEM_PROMPT,
        tools: [],
    },
    // The smoke test intentionally makes no provider or paid API request.
    streamFn: () => {
        throw new Error("The smoke-test runtime must not invoke a model provider.");
    },
});
if (agent.state.tools.length !== 0) {
    throw new Error("The initial seed unexpectedly contains tools.");
}
if (agent.state.systemPrompt !== SEED_SYSTEM_PROMPT) {
    throw new Error("Pi did not preserve the fixed seed system prompt.");
}
console.log(JSON.stringify({
    runtime: "@earendil-works/pi-agent-core",
    providersConfigured: models.getProviders().length,
    initialToolCount: agent.state.tools.length,
    seedCapabilities: SEED_CAPABILITIES,
    modelRequestMade: false,
}, null, 2));
//# sourceMappingURL=smoke.js.map