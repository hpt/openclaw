import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleCommands } from "../auto-reply/reply/commands-core.js";
import { buildCommandTestParams } from "../auto-reply/reply/commands.test-harness.js";
import { withConfigWriteLock } from "./config-write-lock.js";
import { withTempHome } from "./home-env.test-harness.js";
import { createConfigIO, readConfigFileSnapshot } from "./io.js";

describe("config write lock for slash command RMW", () => {
  it("preserves concurrent channel keys when /config set races another locked writer", async () => {
    await withTempHome("openclaw-config-rmw-race-", async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            commands: { text: true, config: true },
            gateway: { mode: "local" },
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

      const params = buildCommandTestParams('/config set agents.defaults.model="gpt-5.4"', {
        commands: { text: true, config: true },
        gateway: { mode: "local" },
      });
      params.command.senderIsOwner = true;
      params.command.channel = "webchat";

      const channelWrite = withConfigWriteLock(async () => {
        const snapshot = await readConfigFileSnapshot();
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

      const [result] = await Promise.all([handleCommands(params), channelWrite]);

      expect(result.reply?.text).toContain("Config updated");
      const persisted = JSON.parse(await fs.readFile(configPath, "utf-8")) as {
        agents?: { defaults?: { model?: unknown } };
        channels?: { telegram?: { botToken?: string; enabled?: boolean } };
      };
      expect(persisted.agents?.defaults?.model).toBe("gpt-5.4");
      expect(persisted.channels?.telegram).toMatchObject({
        enabled: true,
        botToken: "123456:ABCDEF",
      });
    });
  });
});
