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
  migrateTelegramGroupConfig,
  migrateTelegramGroupsInPlace,
  persistTelegramGroupMigration,
} from "./group-migration.js";

function createTelegramGlobalGroupConfig(groups: Record<string, Record<string, unknown>>) {
  return {
    channels: {
      telegram: {
        groups,
      },
    },
  };
}

function createTelegramAccountGroupConfig(
  accountId: string,
  groups: Record<string, Record<string, unknown>>,
) {
  return {
    channels: {
      telegram: {
        accounts: {
          [accountId]: {
            groups,
          },
        },
      },
    },
  };
}

describe("migrateTelegramGroupConfig", () => {
  it("migrates global group ids", () => {
    const cfg = createTelegramGlobalGroupConfig({
      "-123": { requireMention: false },
    });

    const result = migrateTelegramGroupConfig({
      cfg,
      accountId: "default",
      oldChatId: "-123",
      newChatId: "-100123",
    });

    expect(result.migrated).toBe(true);
    expect(cfg.channels.telegram.groups).toEqual({
      "-100123": { requireMention: false },
    });
  });

  it("migrates account-scoped groups", () => {
    const cfg = createTelegramAccountGroupConfig("primary", {
      "-123": { requireMention: true },
    });

    const result = migrateTelegramGroupConfig({
      cfg,
      accountId: "primary",
      oldChatId: "-123",
      newChatId: "-100123",
    });

    expect(result.migrated).toBe(true);
    expect(result.scopes).toEqual(["account"]);
    expect(cfg.channels.telegram.accounts.primary.groups).toEqual({
      "-100123": { requireMention: true },
    });
  });

  it("matches account ids case-insensitively", () => {
    const cfg = createTelegramAccountGroupConfig("Primary", {
      "-123": {},
    });

    const result = migrateTelegramGroupConfig({
      cfg,
      accountId: "primary",
      oldChatId: "-123",
      newChatId: "-100123",
    });

    expect(result.migrated).toBe(true);
    expect(cfg.channels.telegram.accounts.Primary.groups).toEqual({
      "-100123": {},
    });
  });

  it("skips migration when new id already exists", () => {
    const cfg = createTelegramGlobalGroupConfig({
      "-123": { requireMention: true },
      "-100123": { requireMention: false },
    });

    const result = migrateTelegramGroupConfig({
      cfg,
      accountId: "default",
      oldChatId: "-123",
      newChatId: "-100123",
    });

    expect(result.migrated).toBe(false);
    expect(result.skippedExisting).toBe(true);
    expect(cfg.channels.telegram.groups).toEqual({
      "-123": { requireMention: true },
      "-100123": { requireMention: false },
    });
  });

  it("persists a group id move without mutating the live runtime snapshot", async () => {
    await withTempHome("openclaw-telegram-group-migration-", async (home) => {
      const sourceConfig = {
        channels: {
          telegram: {
            groups: {
              "-1001": { requireMention: false },
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
        const result = await persistTelegramGroupMigration({
          cfg: loadConfig(),
          accountId: "default",
          oldChatId: "-1001",
          newChatId: "-1002",
        });

        expect(result.migrated).toBe(true);
        expect(runtimeConfig.channels?.telegram?.groups).toEqual({
          "-1001": { requireMention: false },
        });
        const persisted = JSON.parse(await fs.readFile(configPath, "utf8")) as {
          channels?: { telegram?: { groups?: Record<string, { requireMention?: boolean }> } };
        };
        expect(persisted.channels?.telegram?.groups).toEqual({
          "-1002": { requireMention: false },
        });
        expect(loadConfig().channels?.telegram?.groups).toEqual({
          "-1002": { requireMention: false },
        });
      } finally {
        setRuntimeConfigSnapshotRefreshHandler(null);
        clearRuntimeConfigSnapshot();
        clearConfigCache();
      }
    });
  });

  it("no-ops when old and new group ids are the same", () => {
    const groups = {
      "-123": { requireMention: true },
    };
    const result = migrateTelegramGroupsInPlace(groups, "-123", "-123");
    expect(result).toEqual({ migrated: false, skippedExisting: false });
    expect(groups).toEqual({
      "-123": { requireMention: true },
    });
  });
});
