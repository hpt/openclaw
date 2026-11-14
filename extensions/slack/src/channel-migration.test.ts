import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  loadConfig,
  setRuntimeConfigSnapshot,
  setRuntimeConfigSnapshotRefreshHandler,
} from "../../../src/config/config.js";
import { withTempHome } from "../../../src/config/home-env.test-harness.js";
import type { OpenClawConfig } from "../../../src/config/types.js";
import {
  migrateSlackChannelConfig,
  migrateSlackChannelsInPlace,
  persistSlackChannelMigration,
} from "./channel-migration.js";

function createSlackGlobalChannelConfig(channels: Record<string, Record<string, unknown>>) {
  return {
    channels: {
      slack: {
        channels,
      },
    },
  };
}

function createSlackAccountChannelConfig(
  accountId: string,
  channels: Record<string, Record<string, unknown>>,
) {
  return {
    channels: {
      slack: {
        accounts: {
          [accountId]: {
            channels,
          },
        },
      },
    },
  };
}

describe("migrateSlackChannelConfig", () => {
  it("migrates global channel ids", () => {
    const cfg = createSlackGlobalChannelConfig({
      C123: { requireMention: false },
    });

    const result = migrateSlackChannelConfig({
      cfg,
      accountId: "default",
      oldChannelId: "C123",
      newChannelId: "C999",
    });

    expect(result.migrated).toBe(true);
    expect(cfg.channels.slack.channels).toEqual({
      C999: { requireMention: false },
    });
  });

  it("migrates account-scoped channels", () => {
    const cfg = createSlackAccountChannelConfig("primary", {
      C123: { requireMention: true },
    });

    const result = migrateSlackChannelConfig({
      cfg,
      accountId: "primary",
      oldChannelId: "C123",
      newChannelId: "C999",
    });

    expect(result.migrated).toBe(true);
    expect(result.scopes).toEqual(["account"]);
    expect(cfg.channels.slack.accounts.primary.channels).toEqual({
      C999: { requireMention: true },
    });
  });

  it("matches account ids case-insensitively", () => {
    const cfg = createSlackAccountChannelConfig("Primary", {
      C123: {},
    });

    const result = migrateSlackChannelConfig({
      cfg,
      accountId: "primary",
      oldChannelId: "C123",
      newChannelId: "C999",
    });

    expect(result.migrated).toBe(true);
    expect(cfg.channels.slack.accounts.Primary.channels).toEqual({
      C999: {},
    });
  });

  it("skips migration when new id already exists", () => {
    const cfg = createSlackGlobalChannelConfig({
      C123: { requireMention: true },
      C999: { requireMention: false },
    });

    const result = migrateSlackChannelConfig({
      cfg,
      accountId: "default",
      oldChannelId: "C123",
      newChannelId: "C999",
    });

    expect(result.migrated).toBe(false);
    expect(result.skippedExisting).toBe(true);
    expect(cfg.channels.slack.channels).toEqual({
      C123: { requireMention: true },
      C999: { requireMention: false },
    });
  });

  it("persists a channel id move without mutating the live runtime snapshot", async () => {
    await withTempHome("openclaw-slack-channel-migration-", async (home) => {
      const sourceConfig = {
        channels: {
          slack: {
            channels: {
              C123: { requireMention: false },
            },
          },
        },
      } as OpenClawConfig;
      const runtimeConfig = structuredClone(sourceConfig);
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      await fs.writeFile(configPath, `${JSON.stringify(sourceConfig, null, 2)}\n`, "utf8");
      setRuntimeConfigSnapshotRefreshHandler(null);
      setRuntimeConfigSnapshot(runtimeConfig, structuredClone(sourceConfig));
      try {
        const result = await persistSlackChannelMigration({
          cfg: loadConfig(),
          accountId: "default",
          oldChannelId: "C123",
          newChannelId: "C999",
        });

        expect(result.migrated).toBe(true);
        expect(runtimeConfig.channels?.slack?.channels).toEqual({
          C123: { requireMention: false },
        });
        const persisted = JSON.parse(await fs.readFile(configPath, "utf8")) as {
          channels?: { slack?: { channels?: Record<string, { requireMention?: boolean }> } };
        };
        expect(persisted.channels?.slack?.channels).toEqual({
          C999: { requireMention: false },
        });
        expect(loadConfig().channels?.slack?.channels).toEqual({
          C999: { requireMention: false },
        });
      } finally {
        setRuntimeConfigSnapshotRefreshHandler(null);
        clearRuntimeConfigSnapshot();
        clearConfigCache();
      }
    });
  });

  it("no-ops when old and new channel ids are the same", () => {
    const channels = {
      C123: { requireMention: true },
    };
    const result = migrateSlackChannelsInPlace(channels, "C123", "C123");
    expect(result).toEqual({ migrated: false, skippedExisting: false });
    expect(channels).toEqual({
      C123: { requireMention: true },
    });
  });
});
