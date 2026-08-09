import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadConfig,
  withConfigWriteLock,
  writeConfigFile,
} from "openclaw/plugin-sdk/config-runtime";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginRuntime } from "../runtime-api.js";
import { maybeCreateDynamicAgent } from "./dynamic-agent.js";

const HOME_ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "OPENCLAW_STATE_DIR",
] as const;

let restoreHome: (() => Promise<void>) | null = null;

async function withTempHome(prefix: string, fn: (home: string) => Promise<void>): Promise<void> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(home, ".openclaw"), { recursive: true });

  const previous = Object.fromEntries(HOME_ENV_KEYS.map((key) => [key, process.env[key]] as const));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.OPENCLAW_STATE_DIR = path.join(home, ".openclaw");

  restoreHome = async () => {
    for (const key of HOME_ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await fs.rm(home, { recursive: true, force: true });
  };

  try {
    await fn(home);
  } finally {
    await restoreHome();
    restoreHome = null;
  }
}

afterEach(async () => {
  if (restoreHome) {
    await restoreHome();
    restoreHome = null;
  }
});

function createRuntime(): PluginRuntime {
  return {
    config: {
      loadConfig,
      writeConfigFile,
    },
  } as unknown as PluginRuntime;
}

describe("Feishu dynamic agent config RMW", () => {
  it("preserves both agents when two dynamic creates race", async () => {
    await withTempHome("openclaw-feishu-dynamic-agent-rmw-", async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            gateway: { mode: "local" },
            agents: { list: [{ id: "main", default: true }] },
            bindings: [],
          },
          null,
          2,
        ),
        "utf-8",
      );

      const staleCfg = loadConfig();
      const runtime = createRuntime();
      const dynamicCfg = { enabled: true as const };

      const [first, second] = await Promise.all([
        maybeCreateDynamicAgent({
          cfg: staleCfg,
          runtime,
          senderOpenId: "ou_user_a",
          dynamicCfg,
          log: () => {},
        }),
        maybeCreateDynamicAgent({
          cfg: staleCfg,
          runtime,
          senderOpenId: "ou_user_b",
          dynamicCfg,
          log: () => {},
        }),
      ]);

      expect(first.created).toBe(true);
      expect(second.created).toBe(true);

      const persisted = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
        agents?: { list?: Array<{ id?: string }> };
        bindings?: Array<{
          agentId?: string;
          match?: { channel?: string; peer?: { id?: string } };
        }>;
      };
      const agentIds = new Set((persisted.agents?.list ?? []).map((a) => a.id));
      expect(agentIds.has("feishu-ou_user_a")).toBe(true);
      expect(agentIds.has("feishu-ou_user_b")).toBe(true);

      const boundPeers = new Set(
        (persisted.bindings ?? [])
          .filter((b) => b.match?.channel === "feishu")
          .map((b) => b.match?.peer?.id),
      );
      expect(boundPeers.has("ou_user_a")).toBe(true);
      expect(boundPeers.has("ou_user_b")).toBe(true);
    });
  });

  it("preserves concurrent channel keys when dynamic create races another locked writer", async () => {
    await withTempHome("openclaw-feishu-dynamic-agent-channel-rmw-", async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            gateway: { mode: "local" },
            agents: { list: [{ id: "main", default: true }] },
          },
          null,
          2,
        ),
        "utf-8",
      );

      const staleCfg = loadConfig();
      const runtime = createRuntime();

      const channelWrite = withConfigWriteLock(async () => {
        const cfg = loadConfig();
        await writeConfigFile({
          ...cfg,
          channels: {
            telegram: {
              enabled: true,
              botToken: "123456:ABCDEF",
            },
          },
        });
      });

      const [result] = await Promise.all([
        maybeCreateDynamicAgent({
          cfg: staleCfg,
          runtime,
          senderOpenId: "ou_user_c",
          dynamicCfg: { enabled: true },
          log: () => {},
        }),
        channelWrite,
      ]);

      expect(result.created).toBe(true);

      const persisted = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
        agents?: { list?: Array<{ id?: string }> };
        channels?: { telegram?: { botToken?: string; enabled?: boolean } };
      };
      expect(persisted.agents?.list?.some((a) => a.id === "feishu-ou_user_c")).toBe(true);
      expect(persisted.channels?.telegram).toMatchObject({
        enabled: true,
        botToken: "123456:ABCDEF",
      });
    });
  });
});
