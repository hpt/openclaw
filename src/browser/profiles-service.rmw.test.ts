import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withConfigWriteLock } from "../config/config-write-lock.js";
import { withTempHome } from "../config/home-env.test-harness.js";
import { createConfigIO, loadConfig, writeConfigFile } from "../config/io.js";
import { resolveBrowserConfig } from "./config.js";
import { createBrowserProfilesService } from "./profiles-service.js";
import type { BrowserRouteContext, BrowserServerState } from "./server-context.js";

function createCtx(resolved: BrowserServerState["resolved"]) {
  const state: BrowserServerState = {
    server: null as unknown as BrowserServerState["server"],
    port: 0,
    resolved,
    profiles: new Map(),
  };

  const ctx = {
    state: () => state,
    listProfiles: async () => [],
    forProfile: () => ({
      stopRunningBrowser: async () => ({ stopped: true }),
    }),
  } as unknown as BrowserRouteContext;

  return { state, ctx };
}

describe("BrowserProfilesService config RMW", () => {
  it("preserves concurrent channel keys when profile create races another locked writer", async () => {
    await withTempHome("openclaw-browser-profile-rmw-", async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            gateway: { mode: "local" },
            browser: { profiles: {} },
          },
          null,
          2,
        ),
        "utf-8",
      );

      const io = createConfigIO({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: { warn: () => {}, error: () => {} },
      });

      const { ctx } = createCtx(resolveBrowserConfig(loadConfig().browser ?? {}));
      const service = createBrowserProfilesService(ctx);

      const channelWrite = withConfigWriteLock(async () => {
        const snapshot = await io.readConfigFileSnapshot();
        expect(snapshot.valid).toBe(true);
        const next = structuredClone(snapshot.resolved);
        next.channels = {
          telegram: {
            enabled: true,
            botToken: "123456:ABCDEF",
          },
        };
        await io.writeConfigFile(next);
      });

      const [result] = await Promise.all([service.createProfile({ name: "work" }), channelWrite]);

      expect(result.ok).toBe(true);
      expect(result.profile).toBe("work");

      const persisted = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
        browser?: { profiles?: { work?: { cdpPort?: number } } };
        channels?: { telegram?: { botToken?: string; enabled?: boolean } };
      };
      expect(persisted.browser?.profiles?.work?.cdpPort).toEqual(expect.any(Number));
      expect(persisted.channels?.telegram).toMatchObject({
        enabled: true,
        botToken: "123456:ABCDEF",
      });
    });
  });

  it("preserves concurrent channel keys when profile delete races after slow trash I/O", async () => {
    await withTempHome("openclaw-browser-profile-delete-rmw-", async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            gateway: { mode: "local" },
            browser: {
              defaultProfile: "openclaw",
              profiles: {
                openclaw: { cdpPort: 18800, color: "#FF4500" },
                work: { cdpPort: 18801, color: "#00AA00" },
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      const io = createConfigIO({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: { warn: () => {}, error: () => {} },
      });

      const resolved = resolveBrowserConfig(loadConfig().browser ?? {});
      const { ctx } = createCtx(resolved);
      const service = createBrowserProfilesService(ctx);

      // Simulate a concurrent writer that lands while delete would have held a stale snapshot.
      const channelWrite = (async () => {
        await new Promise((r) => setTimeout(r, 20));
        await withConfigWriteLock(async () => {
          const snapshot = await io.readConfigFileSnapshot();
          const next = structuredClone(snapshot.resolved);
          next.channels = {
            discord: {
              enabled: true,
              token: "discord-bot-token",
            },
          };
          await writeConfigFile(next);
        });
      })();

      const [result] = await Promise.all([service.deleteProfile("work"), channelWrite]);
      expect(result.ok).toBe(true);
      expect(result.profile).toBe("work");

      const persisted = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
        browser?: { profiles?: Record<string, unknown> };
        channels?: { discord?: { token?: string; enabled?: boolean } };
      };
      expect(persisted.browser?.profiles?.work).toBeUndefined();
      expect(persisted.browser?.profiles?.openclaw).toBeTruthy();
      expect(persisted.channels?.discord).toMatchObject({
        enabled: true,
        token: "discord-bot-token",
      });
    });
  });
});
