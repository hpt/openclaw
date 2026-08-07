import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { withFileLock } from "../infra/file-lock.js";
import { readConfigFileSnapshot, writeConfigFile } from "./io.js";
import {
  listConfiguredMcpServers,
  setConfiguredMcpServer,
  unsetConfiguredMcpServer,
} from "./mcp-config.js";
import { withTempHomeConfig } from "./test-helpers.js";

const CONFIG_IO_LOCK_OPTIONS = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 25,
    maxTimeout: 2_500,
    randomize: true,
  },
  stale: 30_000,
} as const;

describe("config mcp config", () => {
  it("writes and removes top-level mcp servers", async () => {
    await withTempHomeConfig({}, async () => {
      const setResult = await setConfiguredMcpServer({
        name: "context7",
        server: {
          command: "uvx",
          args: ["context7-mcp"],
        },
      });

      expect(setResult.ok).toBe(true);
      const loaded = await listConfiguredMcpServers();
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) {
        throw new Error("expected MCP config to load");
      }
      expect(loaded.mcpServers.context7).toEqual({
        command: "uvx",
        args: ["context7-mcp"],
      });

      const unsetResult = await unsetConfiguredMcpServer({ name: "context7" });
      expect(unsetResult.ok).toBe(true);

      const reloaded = await listConfiguredMcpServers();
      expect(reloaded.ok).toBe(true);
      if (!reloaded.ok) {
        throw new Error("expected MCP config to reload");
      }
      expect(reloaded.mcpServers).toEqual({});
    });
  });

  it("preserves concurrent channel writes while setting MCP servers", async () => {
    await withTempHomeConfig({ gateway: { mode: "local" } }, async ({ configPath }) => {
      const channelWrite = withFileLock(configPath, CONFIG_IO_LOCK_OPTIONS, async () => {
        const snapshot = await readConfigFileSnapshot();
        expect(snapshot.valid).toBe(true);
        const next = structuredClone(snapshot.resolved);
        next.channels = {
          telegram: {
            enabled: true,
            botToken: "123456:ABCDEF",
          },
        };
        await writeConfigFile(next);
      });

      const setPromise = setConfiguredMcpServer({
        name: "context7",
        server: {
          command: "uvx",
          args: ["context7-mcp"],
        },
      });

      const [setResult] = await Promise.all([setPromise, channelWrite]);
      expect(setResult.ok).toBe(true);

      const loaded = await listConfiguredMcpServers();
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) {
        throw new Error("expected MCP config to load");
      }
      expect(loaded.mcpServers.context7).toEqual({
        command: "uvx",
        args: ["context7-mcp"],
      });
      expect(loaded.config.channels?.telegram).toMatchObject({
        enabled: true,
        botToken: "123456:ABCDEF",
      });
    });
  });

  it("fails closed when the config file is invalid", async () => {
    await withTempHomeConfig({}, async ({ configPath }) => {
      await fs.writeFile(configPath, "{", "utf-8");

      const loaded = await listConfiguredMcpServers();
      expect(loaded.ok).toBe(false);
      if (loaded.ok) {
        throw new Error("expected invalid config to fail");
      }
      expect(loaded.path).toBe(configPath);
    });
  });
});
