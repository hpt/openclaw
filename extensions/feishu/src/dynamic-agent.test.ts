import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../../src/config/config.js";
import type { PluginRuntime } from "../runtime-api.js";

const readConfigFileSnapshotForWrite = vi.fn();
const writeConfigFile = vi.fn();

vi.mock("openclaw/plugin-sdk/config-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/config-runtime")>();
  return {
    ...actual,
    readConfigFileSnapshotForWrite,
    writeConfigFile,
  };
});

const runtime = { config: { writeConfigFile } } as unknown as PluginRuntime;

function staleMonitorCfg(): OpenClawConfig {
  return {
    channels: {
      feishu: {
        dynamicAgentCreation: { enabled: true },
      },
    },
  } as OpenClawConfig;
}

describe("maybeCreateDynamicAgent", () => {
  let maybeCreateDynamicAgent: typeof import("./dynamic-agent.js").maybeCreateDynamicAgent;
  let tmpRoot = "";

  beforeEach(async () => {
    vi.resetModules();
    ({ maybeCreateDynamicAgent } = await import("./dynamic-agent.js"));
    readConfigFileSnapshotForWrite.mockReset();
    writeConfigFile.mockReset();
    writeConfigFile.mockResolvedValue(undefined);
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-dynamic-agent-"));
  });

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it("skips persist when the in-memory config already has a DM binding", async () => {
    const cfg = {
      bindings: [
        {
          agentId: "feishu-ou_existing",
          match: { channel: "feishu", peer: { kind: "direct", id: "ou_existing" } },
        },
      ],
    } as OpenClawConfig;

    const result = await maybeCreateDynamicAgent({
      cfg,
      runtime,
      senderOpenId: "ou_existing",
      dynamicCfg: { enabled: true },
      log: () => {},
    });

    expect(result.created).toBe(false);
    expect(readConfigFileSnapshotForWrite).not.toHaveBeenCalled();
    expect(writeConfigFile).not.toHaveBeenCalled();
  });

  it("overlays the new agent onto a fresh disk snapshot instead of the stale monitor config", async () => {
    readConfigFileSnapshotForWrite.mockResolvedValue({
      snapshot: {
        exists: true,
        valid: true,
        config: {
          mcp: { servers: { docs: { command: "mcp-docs" } } },
          channels: { telegram: { botToken: "tg-token" } },
          agents: { list: [{ id: "main", workspace: "/tmp/main" }] },
          bindings: [{ agentId: "main", match: { channel: "telegram" } }],
        },
      },
      writeOptions: { expectedConfigPath: "/tmp/openclaw.json" },
    });

    const logs: string[] = [];
    const result = await maybeCreateDynamicAgent({
      cfg: staleMonitorCfg(),
      runtime,
      senderOpenId: "ou_new_user",
      dynamicCfg: {
        enabled: true,
        workspaceTemplate: path.join(tmpRoot, "workspace-{agentId}"),
        agentDirTemplate: path.join(tmpRoot, "agents/{agentId}/agent"),
      },
      log: (msg) => logs.push(msg),
    });

    expect(result.created).toBe(true);
    expect(result.agentId).toBe("feishu-ou_new_user");
    expect(writeConfigFile).toHaveBeenCalledTimes(1);
    const written = writeConfigFile.mock.calls[0]?.[0] as OpenClawConfig;
    expect(written.mcp).toEqual({ servers: { docs: { command: "mcp-docs" } } });
    expect(written.channels).toEqual({ telegram: { botToken: "tg-token" } });
    expect(written.agents?.list).toEqual(
      expect.arrayContaining([
        { id: "main", workspace: "/tmp/main" },
        expect.objectContaining({ id: "feishu-ou_new_user" }),
      ]),
    );
    expect(written.bindings).toEqual(
      expect.arrayContaining([
        { agentId: "main", match: { channel: "telegram" } },
        {
          agentId: "feishu-ou_new_user",
          match: { channel: "feishu", peer: { kind: "direct", id: "ou_new_user" } },
        },
      ]),
    );
    expect(writeConfigFile.mock.calls[0]?.[1]).toEqual({
      expectedConfigPath: "/tmp/openclaw.json",
    });
    expect(logs.some((line) => line.includes("creating dynamic agent"))).toBe(true);
  });

  it("does not write when a concurrent persist already added the DM binding", async () => {
    readConfigFileSnapshotForWrite.mockResolvedValue({
      snapshot: {
        exists: true,
        valid: true,
        config: {
          mcp: { servers: { docs: { command: "mcp-docs" } } },
          bindings: [
            {
              agentId: "feishu-ou_new_user",
              match: { channel: "feishu", peer: { kind: "direct", id: "ou_new_user" } },
            },
          ],
        },
      },
      writeOptions: {},
    });

    const result = await maybeCreateDynamicAgent({
      cfg: staleMonitorCfg(),
      runtime,
      senderOpenId: "ou_new_user",
      dynamicCfg: { enabled: true },
      log: () => {},
    });

    expect(result.created).toBe(false);
    expect(result.updatedCfg.mcp).toEqual({ servers: { docs: { command: "mcp-docs" } } });
    expect(writeConfigFile).not.toHaveBeenCalled();
  });

  it("adds only the missing binding onto the fresh snapshot when the agent already exists", async () => {
    readConfigFileSnapshotForWrite.mockResolvedValue({
      snapshot: {
        exists: true,
        valid: true,
        config: {
          mcp: { servers: { docs: { command: "mcp-docs" } } },
          agents: {
            list: [
              { id: "feishu-ou_new_user", workspace: "/tmp/existing", agentDir: "/tmp/agent" },
            ],
          },
        },
      },
      writeOptions: {},
    });

    const result = await maybeCreateDynamicAgent({
      cfg: staleMonitorCfg(),
      runtime,
      senderOpenId: "ou_new_user",
      dynamicCfg: { enabled: true },
      log: () => {},
    });

    expect(result.created).toBe(true);
    const written = writeConfigFile.mock.calls[0]?.[0] as OpenClawConfig;
    expect(written.mcp).toEqual({ servers: { docs: { command: "mcp-docs" } } });
    expect(written.agents?.list).toEqual([
      { id: "feishu-ou_new_user", workspace: "/tmp/existing", agentDir: "/tmp/agent" },
    ]);
    expect(written.bindings).toEqual([
      {
        agentId: "feishu-ou_new_user",
        match: { channel: "feishu", peer: { kind: "direct", id: "ou_new_user" } },
      },
    ]);
  });

  it("skips persist when the config snapshot is invalid", async () => {
    readConfigFileSnapshotForWrite.mockResolvedValue({
      snapshot: { exists: true, valid: false, config: {} },
      writeOptions: {},
    });

    const result = await maybeCreateDynamicAgent({
      cfg: staleMonitorCfg(),
      runtime,
      senderOpenId: "ou_new_user",
      dynamicCfg: { enabled: true },
      log: () => {},
    });

    expect(result.created).toBe(false);
    expect(writeConfigFile).not.toHaveBeenCalled();
  });
});
