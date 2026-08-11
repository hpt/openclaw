import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  readConfigFileSnapshot,
  readConfigFileSnapshotForWrite,
  writeConfigFile,
  validateConfigObjectWithPlugins,
} = vi.hoisted(() => ({
  readConfigFileSnapshot: vi.fn(),
  readConfigFileSnapshotForWrite: vi.fn(),
  writeConfigFile: vi.fn(),
  validateConfigObjectWithPlugins: vi.fn(),
}));

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    CONFIG_PATH: "/tmp/openclaw-gmail-rmw.json",
    readConfigFileSnapshot,
    readConfigFileSnapshotForWrite,
    writeConfigFile,
    validateConfigObjectWithPlugins,
    resolveGatewayPort: () => 18789,
  };
});

vi.mock("./gmail-setup-utils.js", () => ({
  ensureDependency: vi.fn(async () => {}),
  ensureGcloudAuth: vi.fn(async () => {}),
  ensureSubscription: vi.fn(async () => {}),
  ensureTailscaleEndpoint: vi.fn(async () => "https://example.ts.net/gmail"),
  ensureTopic: vi.fn(async () => {}),
  resolveProjectIdFromGogCredentials: vi.fn(async () => "proj-1"),
  runGcloud: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
}));

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
}));

vi.mock("../runtime.js", () => ({
  defaultRuntime: {
    log: vi.fn(),
    writeJson: vi.fn(),
  },
}));

describe("runGmailSetup config RMW", () => {
  beforeEach(() => {
    vi.resetModules();
    readConfigFileSnapshot.mockReset();
    readConfigFileSnapshotForWrite.mockReset();
    writeConfigFile.mockReset();
    validateConfigObjectWithPlugins.mockReset();
    writeConfigFile.mockResolvedValue(undefined);
    validateConfigObjectWithPlugins.mockImplementation((config: unknown) => ({
      ok: true,
      config,
      warnings: [],
    }));
  });

  it("re-reads config after GCP setup so concurrent channel keys survive the write", async () => {
    readConfigFileSnapshot.mockResolvedValue({
      valid: true,
      config: {
        hooks: {
          enabled: false,
        },
      },
    });
    readConfigFileSnapshotForWrite.mockResolvedValue({
      snapshot: {
        valid: true,
        config: {
          hooks: {
            enabled: false,
          },
          channels: {
            telegram: { botToken: "123:ABC" },
          },
        },
      },
      writeOptions: { expectedConfigPath: "/tmp/openclaw-gmail-rmw.json" },
    });

    const { runGmailSetup } = await import("./gmail-ops.js");
    await runGmailSetup({
      account: "user@example.com",
      project: "proj-1",
      pushEndpoint: "https://example.test/push",
      hookToken: "hook-token",
      pushToken: "push-token",
      tailscale: "off",
    });

    expect(readConfigFileSnapshotForWrite).toHaveBeenCalledTimes(1);
    expect(writeConfigFile).toHaveBeenCalledTimes(1);
    const [written, writeOptions] = writeConfigFile.mock.calls[0] as [
      {
        channels?: { telegram?: { botToken?: string } };
        hooks?: { enabled?: boolean; gmail?: { account?: string } };
      },
      { expectedConfigPath?: string },
    ];
    expect(written.channels?.telegram?.botToken).toBe("123:ABC");
    expect(written.hooks?.enabled).toBe(true);
    expect(written.hooks?.gmail?.account).toBe("user@example.com");
    expect(writeOptions).toEqual({ expectedConfigPath: "/tmp/openclaw-gmail-rmw.json" });
  });
});
