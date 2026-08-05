import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "./home-env.test-harness.js";
import { createConfigIO } from "./io.js";

async function waitForPersistedSecret(configPath: string, expectedSecret: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      commands?: { ownerDisplaySecret?: string };
    };
    if (parsed.commands?.ownerDisplaySecret === expectedSecret) {
      return;
    }
    await sleep(5);
  }
  throw new Error("timed out waiting for ownerDisplaySecret persistence");
}

describe("config io owner display secret autofill", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("auto-generates and persists commands.ownerDisplaySecret in hash mode", async () => {
    await withTempHome("openclaw-owner-display-secret-", async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({ commands: { ownerDisplay: "hash" } }, null, 2),
        "utf-8",
      );

      const io = createConfigIO({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: { warn: () => {}, error: () => {} },
      });
      const cfg = io.loadConfig();
      const secret = cfg.commands?.ownerDisplaySecret;

      expect(secret).toMatch(/^[a-f0-9]{64}$/);
      await waitForPersistedSecret(configPath, secret ?? "");

      const cfgReloaded = io.loadConfig();
      expect(cfgReloaded.commands?.ownerDisplaySecret).toBe(secret);
    });
  });

  it("does not wipe concurrent channel writes when persisting ownerDisplaySecret", async () => {
    await withTempHome("openclaw-owner-display-secret-race-", async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({ commands: { ownerDisplay: "hash" } }, null, 2),
        "utf-8",
      );

      const io = createConfigIO({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: { warn: () => {}, error: () => {} },
      });

      // Trigger auto-persist of a freshly generated ownerDisplaySecret.
      const cfg = io.loadConfig();
      const secret = cfg.commands?.ownerDisplaySecret;
      expect(secret).toMatch(/^[a-f0-9]{64}$/);

      // Concurrent writer adds a channel while the auto-persist is in flight.
      await io.writeConfigFile({
        ...cfg,
        channels: {
          telegram: {
            enabled: true,
            botToken: "123456:ABCDEF", // pragma: allowlist secret
          },
        },
      });

      await waitForPersistedSecret(configPath, secret ?? "");

      const persisted = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
        commands?: { ownerDisplaySecret?: string };
        channels?: { telegram?: { enabled?: boolean } };
      };
      expect(persisted.commands?.ownerDisplaySecret).toBe(secret);
      expect(persisted.channels?.telegram?.enabled).toBe(true);
    });
  });
});
