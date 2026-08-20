import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { persistDoctorConfigMutations, persistGatewayAuthToken } from "./doctor-persist-config.js";

describe("persistDoctorConfigMutations", () => {
  it("overlays doctor mutations onto a fresh snapshot so concurrent keys survive", async () => {
    const writeConfig = vi.fn().mockResolvedValue(undefined);
    const readSnapshot = vi.fn().mockResolvedValue({
      snapshot: {
        valid: true,
        config: {
          gateway: { mode: "local" },
          channels: { telegram: { botToken: "123:ABC" } },
          plugins: { entries: { matrix: { enabled: true } } },
        },
      },
      writeOptions: { expectedConfigPath: "/tmp/openclaw.json" },
    });

    const written = await persistDoctorConfigMutations({
      baseline: { gateway: { mode: "local" } } as OpenClawConfig,
      mutated: {
        gateway: { mode: "local", auth: { mode: "token", token: "doctor-token" } },
      } as OpenClawConfig,
      readSnapshot,
      writeConfig,
    });

    expect(written.channels?.telegram).toEqual({ botToken: "123:ABC" });
    expect(written.plugins?.entries?.matrix).toEqual({ enabled: true });
    expect(written.gateway?.auth?.token).toBe("doctor-token");
    expect(writeConfig).toHaveBeenCalledWith(written, { expectedConfigPath: "/tmp/openclaw.json" });
  });

  it("keeps a gateway token written after the baseline snapshot", async () => {
    const writeConfig = vi.fn().mockResolvedValue(undefined);
    const readSnapshot = vi.fn().mockResolvedValue({
      snapshot: {
        valid: true,
        config: {
          gateway: { mode: "local", auth: { mode: "token", token: "service-token" } },
          channels: { slack: { botToken: "xoxb-1" } },
        },
      },
      writeOptions: {},
    });

    const written = await persistDoctorConfigMutations({
      baseline: { gateway: { mode: "local" } } as OpenClawConfig,
      mutated: {
        gateway: { mode: "local" },
        wizard: { lastRunCommand: "doctor" },
      } as OpenClawConfig,
      readSnapshot,
      writeConfig,
    });

    expect(written.gateway?.auth?.token).toBe("service-token");
    expect(written.channels?.slack).toEqual({ botToken: "xoxb-1" });
    expect(written.wizard?.lastRunCommand).toBe("doctor");
  });

  it("falls back to the in-memory config when the disk snapshot is invalid", async () => {
    const mutated = {
      gateway: { mode: "local", auth: { mode: "token", token: "doctor-token" } },
    } as OpenClawConfig;
    const writeConfig = vi.fn().mockResolvedValue(undefined);

    const written = await persistDoctorConfigMutations({
      baseline: { gateway: { mode: "local" } } as OpenClawConfig,
      mutated,
      readSnapshot: async () => ({
        snapshot: { valid: false, config: {} } as never,
        writeOptions: {},
      }),
      writeConfig,
    });

    expect(written).toBe(mutated);
    expect(writeConfig).toHaveBeenCalledWith(mutated, {});
  });
});

describe("persistGatewayAuthToken", () => {
  it("overlays the recovered token onto a fresh snapshot", async () => {
    const writeConfig = vi.fn().mockResolvedValue(undefined);

    const written = await persistGatewayAuthToken({
      cfg: { gateway: {} } as OpenClawConfig,
      token: "env-token",
      mode: "token",
      readSnapshot: async () => ({
        snapshot: {
          valid: true,
          config: {
            gateway: {},
            channels: { telegram: { botToken: "123:ABC" } },
          },
        } as never,
        writeOptions: { expectedConfigPath: "/tmp/openclaw.json" },
      }),
      writeConfig,
    });

    expect(written.gateway?.auth?.token).toBe("env-token");
    expect(written.channels?.telegram).toEqual({ botToken: "123:ABC" });
    expect(writeConfig).toHaveBeenCalledWith(written, { expectedConfigPath: "/tmp/openclaw.json" });
  });
});
