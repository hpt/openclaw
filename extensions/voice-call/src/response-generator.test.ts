import { describe, expect, it, vi } from "vitest";
import { VoiceCallConfigSchema } from "./config.js";
import type { CoreAgentDeps, CoreConfig } from "./core-bridge.js";
import { generateVoiceResponse } from "./response-generator.js";

function createAgentRuntime(payloads: Array<Record<string, unknown>>) {
  const runEmbeddedPiAgent = vi.fn(async () => ({
    payloads,
    meta: { durationMs: 12, aborted: false },
  }));

  const runtime = {
    defaults: {
      provider: "together",
      model: "Qwen/Qwen2.5-7B-Instruct-Turbo",
    },
    resolveAgentDir: () => "/tmp/openclaw/agents/main",
    resolveAgentWorkspaceDir: () => "/tmp/openclaw/workspace/main",
    resolveAgentIdentity: () => ({ name: "tester" }),
    resolveThinkingDefault: () => "off",
    resolveAgentTimeoutMs: () => 30_000,
    ensureAgentWorkspace: async () => {},
    runEmbeddedPiAgent,
    session: {
      resolveStorePath: () => "/tmp/openclaw/sessions.json",
      loadSessionStore: () => ({}),
      saveSessionStore: async () => {},
      updateSessionStore: async (
        _storePath: string,
        mutator: (store: Record<string, unknown>) => void,
      ) => {
        mutator({});
      },
      resolveSessionFilePath: () => "/tmp/openclaw/sessions/session.jsonl",
    },
  } as unknown as CoreAgentDeps;

  return { runtime, runEmbeddedPiAgent };
}

function requireEmbeddedAgentArgs(runEmbeddedPiAgent: ReturnType<typeof vi.fn>) {
  const calls = runEmbeddedPiAgent.mock.calls as unknown[][];
  const firstCall = calls[0];
  if (!firstCall) {
    throw new Error("voice response generator did not invoke the embedded agent");
  }
  const args = firstCall[0] as { extraSystemPrompt?: string } | undefined;
  if (!args?.extraSystemPrompt) {
    throw new Error("voice response generator did not pass the spoken-output contract prompt");
  }
  return args;
}

async function runGenerateVoiceResponse(
  payloads: Array<Record<string, unknown>>,
  overrides?: {
    runtime?: CoreAgentDeps;
    transcript?: Array<{ speaker: "user" | "bot"; text: string }>;
  },
) {
  const voiceConfig = VoiceCallConfigSchema.parse({
    responseTimeoutMs: 5000,
  });
  const coreConfig = {} as CoreConfig;
  const runtime = overrides?.runtime ?? createAgentRuntime(payloads).runtime;

  const result = await generateVoiceResponse({
    voiceConfig,
    coreConfig,
    agentRuntime: runtime,
    callId: "call-123",
    from: "+15550001111",
    transcript: overrides?.transcript ?? [{ speaker: "user", text: "hello there" }],
    userMessage: "hello there",
  });

  return { result };
}

describe("generateVoiceResponse", () => {
  it("suppresses reasoning payloads and reads structured spoken output", async () => {
    const { runtime, runEmbeddedPiAgent } = createAgentRuntime([
      { text: "Reasoning: hidden", isReasoning: true },
      { text: '{"spoken":"Hello from JSON."}' },
    ]);
    const { result } = await runGenerateVoiceResponse([], { runtime });

    expect(result.text).toBe("Hello from JSON.");
    expect(runEmbeddedPiAgent).toHaveBeenCalledTimes(1);
    const args = requireEmbeddedAgentArgs(runEmbeddedPiAgent);
    expect(args.extraSystemPrompt).toContain('{"spoken":"..."}');
  });

  it("extracts spoken text from fenced JSON", async () => {
    const { result } = await runGenerateVoiceResponse([
      { text: '```json\n{"spoken":"Fenced JSON works."}\n```' },
    ]);

    expect(result.text).toBe("Fenced JSON works.");
  });

  it("returns silence for an explicit empty spoken contract response", async () => {
    const { result } = await runGenerateVoiceResponse([{ text: '{"spoken":""}' }]);

    expect(result.text).toBeNull();
  });

  it("strips leading planning text when model returns plain text", async () => {
    const { result } = await runGenerateVoiceResponse([
      {
        text:
          "The user responded with short text. I should keep the response concise.\n\n" +
          "Sounds good. I can help with the next step whenever you are ready.",
      },
    ]);

    expect(result.text).toBe("Sounds good. I can help with the next step whenever you are ready.");
  });

  it("keeps plain conversational output when no JSON contract is followed", async () => {
    const { result } = await runGenerateVoiceResponse([
      { text: "Absolutely. Tell me what you want to do next." },
    ]);

    expect(result.text).toBe("Absolutely. Tell me what you want to do next.");
  });

  it("creates a missing voice session without rewriting a stale session-store snapshot", async () => {
    const freshStore: Record<string, { sessionId: string; updatedAt: number }> = {
      "agent:main:main": { sessionId: "chat-session", updatedAt: 1 },
      "agent:main:telegram:direct:1": { sessionId: "live-chat", updatedAt: 2 },
    };
    const saveSessionStore = vi.fn(async () => {
      throw new Error("full snapshot save should not run");
    });
    const updateSessionStore = vi.fn(
      async (_storePath: string, mutator: (store: typeof freshStore) => void) => {
        mutator(freshStore);
      },
    );
    const { runtime, runEmbeddedPiAgent } = createAgentRuntime([
      { text: '{"spoken":"Calling you back."}' },
    ]);
    runtime.session.loadSessionStore = (() => ({
      "agent:main:main": { sessionId: "stale-chat", updatedAt: 1 },
    })) as typeof runtime.session.loadSessionStore;
    runtime.session.saveSessionStore = saveSessionStore as typeof runtime.session.saveSessionStore;
    runtime.session.updateSessionStore =
      updateSessionStore as typeof runtime.session.updateSessionStore;

    const { result } = await runGenerateVoiceResponse([], { runtime });

    expect(result.text).toBe("Calling you back.");
    expect(saveSessionStore).not.toHaveBeenCalled();
    expect(updateSessionStore).toHaveBeenCalledTimes(1);
    expect(freshStore["agent:main:telegram:direct:1"]?.sessionId).toBe("live-chat");
    expect(freshStore["voice:15550001111"]?.sessionId).toEqual(expect.any(String));
    expect(runEmbeddedPiAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: freshStore["voice:15550001111"]?.sessionId,
      }),
    );
  });

  it("reuses an existing voice session without writing the session store", async () => {
    const saveSessionStore = vi.fn(async () => {});
    const updateSessionStore = vi.fn(async () => {});
    const { runtime } = createAgentRuntime([{ text: '{"spoken":"Still here."}' }]);
    runtime.session.loadSessionStore = (() => ({
      "voice:15550001111": { sessionId: "existing-voice", updatedAt: 5 },
      "agent:main:main": { sessionId: "chat-session", updatedAt: 1 },
    })) as typeof runtime.session.loadSessionStore;
    runtime.session.saveSessionStore = saveSessionStore as typeof runtime.session.saveSessionStore;
    runtime.session.updateSessionStore =
      updateSessionStore as typeof runtime.session.updateSessionStore;

    const { result } = await runGenerateVoiceResponse([], { runtime });

    expect(result.text).toBe("Still here.");
    expect(saveSessionStore).not.toHaveBeenCalled();
    expect(updateSessionStore).not.toHaveBeenCalled();
  });
});
