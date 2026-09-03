import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempHome } from "./home-env.test-harness.js";
import { clearConfigCache, writeConfigFile } from "./io.js";
import { mergeConfigMutationsOntoFresh } from "./merge-patch.js";
import { writeConfigFilePreservingConcurrentKeys } from "./persist-config-mutations.js";
import type { OpenClawConfig } from "./types.js";

describe("mergeConfigMutationsOntoFresh", () => {
  it("overlays only the intended delta and keeps concurrent keys", () => {
    const baseline: OpenClawConfig = {
      channels: { telegram: { botToken: "tg-token" } },
    };
    const next: OpenClawConfig = {
      channels: { telegram: { botToken: "tg-token" } },
      plugins: { entries: { matrix: { enabled: true } } },
    };
    const fresh: OpenClawConfig = {
      channels: { telegram: { botToken: "tg-token" } },
      mcp: { servers: { docs: { command: "mcp-docs" } } },
    };

    expect(
      mergeConfigMutationsOntoFresh({
        fresh,
        baseline,
        next,
      }),
    ).toEqual({
      channels: { telegram: { botToken: "tg-token" } },
      mcp: { servers: { docs: { command: "mcp-docs" } } },
      plugins: { entries: { matrix: { enabled: true } } },
    });
  });
});

describe("writeConfigFilePreservingConcurrentKeys", () => {
  it("does not wipe concurrent MCP keys after a stale on-demand plugin persist", async () => {
    await withTempHome("openclaw-persist-concurrent-", async (home) => {
      const configPath = path.join(home, ".openclaw", "openclaw.json");
      const baseline: OpenClawConfig = {
        channels: { telegram: { enabled: true } },
      };
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf-8");
      clearConfigCache();

      const staleNext: OpenClawConfig = {
        ...baseline,
        plugins: { entries: { matrix: { enabled: true } } },
      };

      await writeConfigFile({
        ...baseline,
        mcp: { servers: { docs: { command: "mcp-docs" } } },
      });

      await writeConfigFilePreservingConcurrentKeys({
        baseline,
        next: staleNext,
      });

      const persisted = JSON.parse(await fs.readFile(configPath, "utf-8")) as OpenClawConfig;
      expect(persisted.plugins?.entries?.matrix).toEqual({ enabled: true });
      expect(persisted.mcp?.servers?.docs).toEqual({ command: "mcp-docs" });
      expect(persisted.channels?.telegram?.enabled).toBe(true);
    });
  });
});
