import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { mergePluginUpdateConfigOntoFresh } from "./merge-config-after-update.js";

describe("mergePluginUpdateConfigOntoFresh", () => {
  it("overlays changed plugin installs onto a fresh snapshot without wiping channels", () => {
    const baselineInstall = {
      source: "npm" as const,
      spec: "@openclaw/alpha@1.0.0",
    };
    const updatedInstall = {
      source: "npm" as const,
      spec: "@openclaw/alpha@1.1.0",
      version: "1.1.0",
    };
    const baseline = {
      plugins: { installs: { alpha: baselineInstall } },
    } as OpenClawConfig;
    const updated = {
      plugins: { installs: { alpha: updatedInstall } },
    } as OpenClawConfig;
    const fresh = {
      plugins: { installs: { alpha: baselineInstall } },
      channels: { telegram: { botToken: "123:ABC" } },
    } as OpenClawConfig;

    const merged = mergePluginUpdateConfigOntoFresh({ baseline, updated, fresh });

    expect(merged.plugins?.installs?.alpha).toEqual(updatedInstall);
    expect(merged.channels?.telegram).toEqual({ botToken: "123:ABC" });
  });

  it("preserves concurrent plugin installs added while the update ran", () => {
    const baselineInstall = {
      source: "npm" as const,
      spec: "@openclaw/alpha@1.0.0",
    };
    const updatedInstall = {
      source: "npm" as const,
      spec: "@openclaw/alpha@1.1.0",
    };
    const concurrentInstall = {
      source: "npm" as const,
      spec: "@openclaw/beta@2.0.0",
    };
    const baseline = {
      plugins: { installs: { alpha: baselineInstall } },
    } as OpenClawConfig;
    const updated = {
      plugins: { installs: { alpha: updatedInstall } },
    } as OpenClawConfig;
    const fresh = {
      plugins: {
        installs: {
          alpha: baselineInstall,
          beta: concurrentInstall,
        },
      },
    } as OpenClawConfig;

    const merged = mergePluginUpdateConfigOntoFresh({ baseline, updated, fresh });

    expect(merged.plugins?.installs?.alpha).toEqual(updatedInstall);
    expect(merged.plugins?.installs?.beta).toEqual(concurrentInstall);
  });

  it("applies plugin id migration deletions onto the fresh snapshot", () => {
    const install = {
      source: "npm" as const,
      spec: "@openclaw/renamed@1.0.0",
    };
    const baseline = {
      plugins: {
        installs: { old: install },
        allow: ["old"],
        entries: { old: { enabled: true } },
      },
    } as OpenClawConfig;
    const updated = {
      plugins: {
        installs: { renamed: install },
        allow: ["renamed"],
        entries: { renamed: { enabled: true } },
      },
    } as OpenClawConfig;
    const fresh = {
      plugins: {
        installs: { old: install },
        allow: ["old"],
        entries: { old: { enabled: true } },
        slots: { memory: "memory-core" },
      },
      mcp: { servers: { docs: { command: "npx" } } },
    } as OpenClawConfig;

    const merged = mergePluginUpdateConfigOntoFresh({ baseline, updated, fresh });

    expect(merged.plugins?.installs?.old).toBeUndefined();
    expect(merged.plugins?.installs?.renamed).toEqual(install);
    expect(merged.plugins?.allow).toEqual(["renamed"]);
    expect(merged.plugins?.entries?.old).toBeUndefined();
    expect(merged.plugins?.entries?.renamed).toEqual({ enabled: true });
    expect(merged.plugins?.slots?.memory).toBe("memory-core");
    expect(merged.mcp?.servers?.docs).toEqual({ command: "npx" });
  });
});
