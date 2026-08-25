import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "./config.js";

const mocks = vi.hoisted(() => ({
  readConfigFileSnapshotForWrite: vi.fn(),
  writeConfigFile: vi.fn(),
}));

vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return {
    ...actual,
    readConfigFileSnapshotForWrite: mocks.readConfigFileSnapshotForWrite,
    writeConfigFile: mocks.writeConfigFile,
  };
});

const { writeConfigFilePreservingConcurrentKeys } = await import("./persist-config-mutations.js");

describe("writeConfigFilePreservingConcurrentKeys", () => {
  beforeEach(() => {
    mocks.readConfigFileSnapshotForWrite.mockReset();
    mocks.writeConfigFile.mockReset().mockResolvedValue(undefined);
  });

  it("overlays mutations onto a fresh disk snapshot before persist", async () => {
    const baseline = { channels: { telegram: { enabled: true } } } as OpenClawConfig;
    const mutated = {
      channels: {
        telegram: { enabled: true },
        msteams: { enabled: true },
      },
    } as OpenClawConfig;
    mocks.readConfigFileSnapshotForWrite.mockResolvedValue({
      snapshot: {
        exists: true,
        valid: true,
        config: {
          channels: { telegram: { enabled: true } },
          mcp: { servers: { github: { command: "uvx" } } },
        },
      },
      writeOptions: {},
    });

    const written = await writeConfigFilePreservingConcurrentKeys({ baseline, mutated });

    expect(written.mcp).toEqual({ servers: { github: { command: "uvx" } } });
    expect(written.channels).toEqual({
      telegram: { enabled: true },
      msteams: { enabled: true },
    });
    expect(mocks.writeConfigFile).toHaveBeenCalledWith(written);
  });

  it("falls back to the in-memory mutated config when disk is invalid", async () => {
    const baseline = { channels: { telegram: { enabled: true } } } as OpenClawConfig;
    const mutated = {
      channels: { msteams: { enabled: true } },
    } as OpenClawConfig;
    mocks.readConfigFileSnapshotForWrite.mockResolvedValue({
      snapshot: {
        exists: true,
        valid: false,
        config: {},
      },
      writeOptions: {},
    });

    const written = await writeConfigFilePreservingConcurrentKeys({ baseline, mutated });
    expect(written).toBe(mutated);
    expect(mocks.writeConfigFile).toHaveBeenCalledWith(mutated);
  });
});
