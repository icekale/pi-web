import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

function makeInner(overrides = {}) {
  const emitted = [];
  return {
    sessionId: "ui-prompt-session",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    model: undefined,
    modelRuntime: {
      getModel: () => undefined,
      refresh: async () => {},
    },
    sessionManager: { getCwd: () => process.cwd() },
    settingsManager: { setProjectTrusted: () => {} },
    agent: { state: {} },
    extensionRunner: {
      getRegisteredCommands: () => [],
      setUIContext: () => {},
      emit: async (event) => { emitted.push(event); },
    },
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    subscribe: () => () => {},
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    pendingMessageCount: 0,
    dispose: () => {},
    reload: async () => {},
    emitted,
    ...overrides,
  };
}

function promptEvents(events) {
  return events.filter((event) => event.type === "ui_prompt_start" || event.type === "ui_prompt_end");
}

function requestId(events, method) {
  const request = events.find((event) => event.type === "extension_ui_request" && event.method === method);
  assert.ok(request, `missing ${method} request`);
  return request.id;
}

test("emits one ui_prompt span around a blocking confirm", async () => {
  const inner = makeInner();
  const events = [];
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onEvent((event) => events.push(event));
  try {
    const context = wrapper.createExtensionUiContext();

    const pending = context.confirm("Continue?", "Apply this change?");
    assert.deepEqual(promptEvents(events), [{
      type: "ui_prompt_start",
      reason: "ui_prompt",
      kind: "confirm",
      title: "Continue?",
    }]);
    assert.deepEqual(promptEvents(inner.emitted), [{
      type: "ui_prompt_start",
      reason: "ui_prompt",
      kind: "confirm",
      title: "Continue?",
    }]);

    await wrapper.send({
      type: "extension_ui_response",
      id: requestId(events, "confirm"),
      confirmed: true,
    });
    assert.equal(await pending, true);
    assert.deepEqual(promptEvents(events).at(-1), {
      type: "ui_prompt_end",
      reason: "ui_prompt",
      kind: "confirm",
      title: "Continue?",
    });
  } finally {
    wrapper.destroy();
  }
});

test("coalesces nested ui prompts into one waiting span", async () => {
  const events = [];
  const wrapper = new AgentSessionWrapper(makeInner());
  wrapper.onEvent((event) => events.push(event));
  try {
    const context = wrapper.createExtensionUiContext();

    const select = context.select("Pick a file", ["a.ts", "b.ts"]);
    const confirm = context.confirm("Overwrite?", "Replace the file?");
    assert.deepEqual(promptEvents(events), [{
      type: "ui_prompt_start",
      reason: "ui_prompt",
      kind: "select",
      title: "Pick a file",
    }]);

    await wrapper.send({
      type: "extension_ui_response",
      id: requestId(events, "select"),
      value: "a.ts",
    });
    assert.equal(await select, "a.ts");
    assert.equal(promptEvents(events).length, 1);

    await wrapper.send({
      type: "extension_ui_response",
      id: requestId(events, "confirm"),
      confirmed: false,
    });
    assert.equal(await confirm, false);
    assert.equal(promptEvents(events).length, 2);
    assert.equal(promptEvents(events).at(-1).type, "ui_prompt_end");
  } finally {
    wrapper.destroy();
  }
});
