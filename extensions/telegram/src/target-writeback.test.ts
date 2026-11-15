import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../../src/config/config.js";

const readConfigFileSnapshotForWrite = vi.fn();
const writeConfigFile = vi.fn();
const resolveCronStorePath = vi.fn();
const mutateCronStore = vi.fn();

vi.mock("openclaw/plugin-sdk/config-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/config-runtime")>();
  return {
    ...actual,
    readConfigFileSnapshotForWrite,
    writeConfigFile,
    resolveCronStorePath,
    mutateCronStore,
  };
});

describe("maybePersistResolvedTelegramTarget", () => {
  let maybePersistResolvedTelegramTarget: typeof import("./target-writeback.js").maybePersistResolvedTelegramTarget;

  beforeEach(async () => {
    vi.resetModules();
    ({ maybePersistResolvedTelegramTarget } = await import("./target-writeback.js"));
    readConfigFileSnapshotForWrite.mockReset();
    writeConfigFile.mockReset();
    resolveCronStorePath.mockReset();
    mutateCronStore.mockReset();
    resolveCronStorePath.mockReturnValue("/tmp/cron/jobs.json");
    mutateCronStore.mockImplementation(
      async (_storePath: string, mutator: (store: { version: 1; jobs: never[] }) => boolean) =>
        mutator({ version: 1, jobs: [] }),
    );
  });

  it("skips writeback when target is already numeric", async () => {
    await maybePersistResolvedTelegramTarget({
      cfg: {} as OpenClawConfig,
      rawTarget: "-100123",
      resolvedChatId: "-100123",
    });

    expect(readConfigFileSnapshotForWrite).not.toHaveBeenCalled();
    expect(mutateCronStore).not.toHaveBeenCalled();
  });

  it("writes back matching config and cron targets", async () => {
    readConfigFileSnapshotForWrite.mockResolvedValue({
      snapshot: {
        config: {
          channels: {
            telegram: {
              defaultTo: "t.me/mychannel",
              accounts: {
                alerts: {
                  defaultTo: "@mychannel",
                },
              },
            },
          },
        },
      },
      writeOptions: { expectedConfigPath: "/tmp/openclaw.json" },
    });
    const cronJobs = [
      { id: "a", delivery: { channel: "telegram", to: "https://t.me/mychannel" } },
      { id: "b", delivery: { channel: "slack", to: "C123" } },
    ];
    mutateCronStore.mockImplementation(
      async (
        _storePath: string,
        mutator: (store: { version: 1; jobs: typeof cronJobs }) => boolean,
      ) => mutator({ version: 1, jobs: cronJobs }),
    );

    await maybePersistResolvedTelegramTarget({
      cfg: {
        cron: { store: "/tmp/cron/jobs.json" },
      } as OpenClawConfig,
      rawTarget: "t.me/mychannel",
      resolvedChatId: "-100123",
    });

    expect(writeConfigFile).toHaveBeenCalledTimes(1);
    expect(writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: {
          telegram: {
            defaultTo: "-100123",
            accounts: {
              alerts: {
                defaultTo: "-100123",
              },
            },
          },
        },
      }),
      expect.objectContaining({ expectedConfigPath: "/tmp/openclaw.json" }),
    );
    expect(mutateCronStore).toHaveBeenCalledWith("/tmp/cron/jobs.json", expect.any(Function));
    expect(cronJobs).toEqual([
      { id: "a", delivery: { channel: "telegram", to: "-100123" } },
      { id: "b", delivery: { channel: "slack", to: "C123" } },
    ]);
  });

  it("preserves topic suffix style in writeback target", async () => {
    readConfigFileSnapshotForWrite.mockResolvedValue({
      snapshot: {
        config: {
          channels: {
            telegram: {
              defaultTo: "t.me/mychannel:topic:9",
            },
          },
        },
      },
      writeOptions: {},
    });
    mutateCronStore.mockImplementation(
      async (_storePath: string, mutator: (store: { version: 1; jobs: never[] }) => boolean) =>
        mutator({ version: 1, jobs: [] }),
    );

    await maybePersistResolvedTelegramTarget({
      cfg: {} as OpenClawConfig,
      rawTarget: "t.me/mychannel:topic:9",
      resolvedChatId: "-100123",
    });

    expect(writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: {
          telegram: {
            defaultTo: "-100123:topic:9",
          },
        },
      }),
      expect.any(Object),
    );
  });

  it("matches username targets case-insensitively", async () => {
    readConfigFileSnapshotForWrite.mockResolvedValue({
      snapshot: {
        config: {
          channels: {
            telegram: {
              defaultTo: "https://t.me/mychannel",
            },
          },
        },
      },
      writeOptions: {},
    });
    const cronJobs = [{ id: "a", delivery: { channel: "telegram", to: "https://t.me/mychannel" } }];
    mutateCronStore.mockImplementation(
      async (
        _storePath: string,
        mutator: (store: { version: 1; jobs: typeof cronJobs }) => boolean,
      ) => mutator({ version: 1, jobs: cronJobs }),
    );

    await maybePersistResolvedTelegramTarget({
      cfg: {} as OpenClawConfig,
      rawTarget: "@MyChannel",
      resolvedChatId: "-100123",
    });

    expect(writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: {
          telegram: {
            defaultTo: "-100123",
          },
        },
      }),
      expect.any(Object),
    );
    expect(cronJobs).toEqual([{ id: "a", delivery: { channel: "telegram", to: "-100123" } }]);
  });
});
