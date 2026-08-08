import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";
import {
  seedSessionStore,
  setupTelegramHeartbeatPluginRuntimeForTests,
  withTempTelegramHeartbeatSandbox,
} from "./heartbeat-runner.test-utils.js";

beforeEach(() => {
  setupTelegramHeartbeatPluginRuntimeForTests();
});

describe("heartbeat transcript pruning", () => {
  async function createTranscriptWithContent(transcriptPath: string, sessionId: string) {
    const header = {
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    };
    const existingContent = `${JSON.stringify(header)}\n{"role":"user","content":"Hello"}\n{"role":"assistant","content":"Hi there"}\n`;
    await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
    await fs.writeFile(transcriptPath, existingContent);
    return existingContent;
  }

  it("does not byte-truncate shared main-session transcripts after HEARTBEAT_OK", async () => {
    await withTempTelegramHeartbeatSandbox(
      async ({ tmpDir, storePath, replySpy }) => {
        const sessionKey = resolveMainSessionKey(undefined);
        const sessionId = "test-session-shared-preserve";
        const transcriptPath = path.join(tmpDir, `${sessionId}.jsonl`);
        const originalContent = await createTranscriptWithContent(transcriptPath, sessionId);

        await seedSessionStore(storePath, sessionKey, {
          sessionId,
          lastChannel: "telegram",
          lastProvider: "telegram",
          lastTo: "user123",
        });

        const concurrentLine =
          '{"role":"user","content":"concurrent followup after heartbeat unlock"}\n';
        replySpy.mockImplementationOnce(async () => {
          // Simulate a concurrent append after the heartbeat run releases the
          // session write lock but before pruneHeartbeatTranscript runs.
          await fs.appendFile(transcriptPath, concurrentLine);
          return {
            text: "HEARTBEAT_OK",
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          };
        });

        const cfg = {
          version: 1,
          model: "test-model",
          agent: { workspace: tmpDir },
          sessionStore: storePath,
          channels: { telegram: {} },
        } as unknown as OpenClawConfig;

        await runHeartbeatOnce({
          agentId: undefined,
          reason: "test",
          cfg,
          deps: { sendTelegram: vi.fn() },
        });

        const finalContent = await fs.readFile(transcriptPath, "utf-8");
        expect(finalContent).toBe(`${originalContent}${concurrentLine}`);
      },
      { prefix: "openclaw-hb-prune-shared-" },
    );
  });

  it("does not prune transcript when heartbeat returns meaningful content", async () => {
    await withTempTelegramHeartbeatSandbox(
      async ({ tmpDir, storePath, replySpy }) => {
        const sessionKey = resolveMainSessionKey(undefined);
        const sessionId = "test-session-no-prune";
        const transcriptPath = path.join(tmpDir, `${sessionId}.jsonl`);
        const originalContent = await createTranscriptWithContent(transcriptPath, sessionId);
        const originalSize = (await fs.stat(transcriptPath)).size;

        await seedSessionStore(storePath, sessionKey, {
          sessionId,
          lastChannel: "telegram",
          lastProvider: "telegram",
          lastTo: "user123",
        });

        const appended =
          '{"role":"assistant","content":"Alert: Something needs your attention!"}\n';
        replySpy.mockImplementationOnce(async () => {
          await fs.appendFile(transcriptPath, appended);
          return {
            text: "Alert: Something needs your attention!",
            usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
          };
        });

        const cfg = {
          version: 1,
          model: "test-model",
          agent: { workspace: tmpDir },
          sessionStore: storePath,
          channels: { telegram: {} },
        } as unknown as OpenClawConfig;

        await runHeartbeatOnce({
          agentId: undefined,
          reason: "test",
          cfg,
          deps: { sendTelegram: vi.fn() },
        });

        const finalContent = await fs.readFile(transcriptPath, "utf-8");
        const finalSize = (await fs.stat(transcriptPath)).size;
        expect(finalContent).toBe(`${originalContent}${appended}`);
        expect(finalSize).toBeGreaterThan(originalSize);
      },
      { prefix: "openclaw-hb-prune-" },
    );
  });
});
