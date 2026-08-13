import { beforeEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  buildPluginStatusReport,
  loadConfig,
  parseClawHubPluginSpec,
  promptYesNo,
  readConfigFileSnapshotForWrite,
  resetPluginsCliTestState,
  runPluginsCommand,
  runtimeErrors,
  runtimeLogs,
  uninstallPlugin,
  writeConfigFile,
} from "./plugins-cli-test-helpers.js";

describe("plugins cli uninstall", () => {
  beforeEach(() => {
    resetPluginsCliTestState();
  });

  it("shows uninstall dry-run preview without mutating config", async () => {
    loadConfig.mockReturnValue({
      plugins: {
        entries: {
          alpha: {
            enabled: true,
          },
        },
        installs: {
          alpha: {
            source: "path",
            sourcePath: "/tmp/openclaw-state/extensions/alpha",
            installPath: "/tmp/openclaw-state/extensions/alpha",
          },
        },
      },
    } as OpenClawConfig);
    buildPluginStatusReport.mockReturnValue({
      plugins: [{ id: "alpha", name: "alpha" }],
      diagnostics: [],
    });

    await runPluginsCommand(["plugins", "uninstall", "alpha", "--dry-run"]);

    expect(uninstallPlugin).not.toHaveBeenCalled();
    expect(writeConfigFile).not.toHaveBeenCalled();
    expect(runtimeLogs.some((line) => line.includes("Dry run, no changes made."))).toBe(true);
  });

  it("uninstalls with --force and --keep-files without prompting", async () => {
    const baseConfig = {
      plugins: {
        entries: {
          alpha: { enabled: true },
        },
        installs: {
          alpha: {
            source: "path",
            sourcePath: "/tmp/openclaw-state/extensions/alpha",
            installPath: "/tmp/openclaw-state/extensions/alpha",
          },
        },
      },
    } as OpenClawConfig;
    const staleRemoved = {
      plugins: {
        entries: {},
        installs: {},
      },
    } as OpenClawConfig;

    loadConfig.mockReturnValue(baseConfig);
    buildPluginStatusReport.mockReturnValue({
      plugins: [{ id: "alpha", name: "alpha" }],
      diagnostics: [],
    });
    uninstallPlugin.mockResolvedValue({
      ok: true,
      config: staleRemoved,
      warnings: [],
      actions: {
        entry: true,
        install: true,
        allowlist: false,
        loadPath: false,
        memorySlot: false,
        directory: false,
      },
    });

    await runPluginsCommand(["plugins", "uninstall", "alpha", "--force", "--keep-files"]);

    expect(promptYesNo).not.toHaveBeenCalled();
    expect(uninstallPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "alpha",
        deleteFiles: false,
      }),
    );
    const written = writeConfigFile.mock.calls[0]?.[0];
    expect(written.plugins?.entries?.alpha).toBeUndefined();
    expect(written.plugins?.installs?.alpha).toBeUndefined();
  });

  it("re-reads config before persist so concurrent keys survive uninstall I/O", async () => {
    const baseConfig = {
      gateway: { mode: "local" },
      plugins: {
        entries: {
          alpha: { enabled: true },
        },
        installs: {
          alpha: {
            source: "npm",
            spec: "alpha@1.0.0",
          },
        },
      },
    } as OpenClawConfig;
    const staleRemoved = {
      gateway: { mode: "local" },
      plugins: {
        entries: {},
        installs: {},
      },
    } as OpenClawConfig;
    const freshDuringDelete = {
      gateway: { mode: "local" },
      plugins: {
        entries: {
          alpha: { enabled: true },
          concurrent: { enabled: true },
        },
        installs: {
          alpha: {
            source: "npm",
            spec: "alpha@1.0.0",
          },
        },
      },
    } as OpenClawConfig;

    loadConfig.mockReturnValue(baseConfig);
    readConfigFileSnapshotForWrite.mockResolvedValue({
      snapshot: {
        path: "/tmp/openclaw-config.json5",
        exists: true,
        raw: "{}",
        parsed: freshDuringDelete,
        resolved: freshDuringDelete,
        valid: true,
        config: freshDuringDelete,
        hash: "mock",
        issues: [],
        warnings: [],
        legacyIssues: [],
      },
      writeOptions: {},
    });
    buildPluginStatusReport.mockReturnValue({
      plugins: [{ id: "alpha", name: "alpha" }],
      diagnostics: [],
    });
    uninstallPlugin.mockResolvedValue({
      ok: true,
      config: staleRemoved,
      warnings: [],
      actions: {
        entry: true,
        install: true,
        allowlist: false,
        loadPath: false,
        memorySlot: false,
        directory: true,
      },
    });

    await runPluginsCommand(["plugins", "uninstall", "alpha", "--force"]);

    expect(writeConfigFile).not.toHaveBeenCalledWith(staleRemoved);
    const written = writeConfigFile.mock.calls[0]?.[0];
    expect(written.plugins?.entries?.alpha).toBeUndefined();
    expect(written.plugins?.installs?.alpha).toBeUndefined();
    expect(written.plugins?.entries?.concurrent).toEqual({ enabled: true });
  });

  it("exits when uninstall target is not managed by plugin install records", async () => {
    loadConfig.mockReturnValue({
      plugins: {
        entries: {},
        installs: {},
      },
    } as OpenClawConfig);
    buildPluginStatusReport.mockReturnValue({
      plugins: [{ id: "alpha", name: "alpha" }],
      diagnostics: [],
    });

    await expect(runPluginsCommand(["plugins", "uninstall", "alpha", "--force"])).rejects.toThrow(
      "__exit__:1",
    );

    expect(runtimeErrors.at(-1)).toContain("is not managed by plugins config/install records");
    expect(uninstallPlugin).not.toHaveBeenCalled();
  });

  it("accepts the recorded ClawHub spec as an uninstall target", async () => {
    loadConfig.mockReturnValue({
      plugins: {
        entries: {
          "linkmind-context": { enabled: true },
        },
        installs: {
          "linkmind-context": {
            source: "npm",
            spec: "clawhub:linkmind-context",
            clawhubPackage: "linkmind-context",
          },
        },
      },
    } as OpenClawConfig);
    buildPluginStatusReport.mockReturnValue({
      plugins: [{ id: "linkmind-context", name: "linkmind-context" }],
      diagnostics: [],
    });
    parseClawHubPluginSpec.mockImplementation((raw: string) =>
      raw === "clawhub:linkmind-context" ? { name: "linkmind-context" } : null,
    );

    await runPluginsCommand(["plugins", "uninstall", "clawhub:linkmind-context", "--force"]);

    expect(uninstallPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "linkmind-context",
      }),
    );
  });

  it("accepts a versionless ClawHub spec when the install was pinned", async () => {
    loadConfig.mockReturnValue({
      plugins: {
        entries: {
          "linkmind-context": { enabled: true },
        },
        installs: {
          "linkmind-context": {
            source: "npm",
            spec: "clawhub:linkmind-context@1.2.3",
          },
        },
      },
    } as OpenClawConfig);
    buildPluginStatusReport.mockReturnValue({
      plugins: [{ id: "linkmind-context", name: "linkmind-context" }],
      diagnostics: [],
    });
    parseClawHubPluginSpec.mockImplementation((raw: string) => {
      if (raw === "clawhub:linkmind-context") {
        return { name: "linkmind-context" };
      }
      if (raw === "clawhub:linkmind-context@1.2.3") {
        return { name: "linkmind-context", version: "1.2.3" };
      }
      return null;
    });

    await runPluginsCommand(["plugins", "uninstall", "clawhub:linkmind-context", "--force"]);

    expect(uninstallPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "linkmind-context",
      }),
    );
  });
});
