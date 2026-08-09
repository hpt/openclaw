import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadConfig,
  withConfigWriteLock,
  writeConfigFile,
} from "openclaw/plugin-sdk/config-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./matrix/actions/profile.js", () => ({
  updateMatrixOwnProfile: vi.fn(async () => {
    // Simulate slow Matrix API / avatar upload while another writer lands.
    await new Promise((r) => setTimeout(r, 40));
    return {
      displayNameUpdated: true,
      avatarUpdated: false,
      resolvedAvatarUrl: null,
      uploadedAvatarSource: null,
      convertedAvatarFromHttp: false,
    };
  }),
}));

vi.mock("./runtime.js", () => ({
  getMatrixRuntime: () => ({
    config: {
      loadConfig,
      writeConfigFile,
    },
  }),
}));

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

describe("Matrix profile-update config RMW", () => {
  it("preserves concurrent channel keys when profile sync races another locked writer", async () => {
    await withTempHome("openclaw-matrix-profile-rmw-", async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            gateway: { mode: "local" },
            channels: {
              matrix: {
                enabled: true,
                homeserver: "https://matrix.example.org",
                accessToken: "syt_example",
                userId: "@bot:example.org",
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      // Prime config cache under the temp home before racing writers.
      loadConfig();

      const { applyMatrixProfileUpdate } = await import("./profile-update.js");

      const channelWrite = withConfigWriteLock(async () => {
        const cfg = loadConfig();
        await writeConfigFile({
          ...cfg,
          channels: {
            ...cfg.channels,
            telegram: {
              enabled: true,
              botToken: "123456:ABCDEF",
            },
          },
        });
      });

      const [result] = await Promise.all([
        applyMatrixProfileUpdate({ displayName: "OpenClaw Bot" }),
        channelWrite,
      ]);

      expect(result.displayName).toBe("OpenClaw Bot");
      expect(result.profile.displayNameUpdated).toBe(true);

      const persisted = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
        channels?: {
          matrix?: { name?: string };
          telegram?: { botToken?: string; enabled?: boolean };
        };
      };
      expect(persisted.channels?.matrix?.name).toBe("OpenClaw Bot");
      expect(persisted.channels?.telegram).toMatchObject({
        enabled: true,
        botToken: "123456:ABCDEF",
      });
    });
  });
});
