import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelPlugin } from "../../channels/plugins/types.js";
import type { OpenClawConfig } from "../../config/config.js";
import { logoutChannelAccount } from "./channels.js";
import type { GatewayRequestContext } from "./types.js";

const mocks = vi.hoisted(() => ({
  readConfigFileSnapshot: vi.fn(),
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
  readConfigFileSnapshot: mocks.readConfigFileSnapshot,
}));

function createPlugin(params?: {
  logoutAccount?: (ctx: {
    cfg: OpenClawConfig;
    accountId: string;
    account: unknown;
  }) => Promise<{ cleared: boolean; loggedOut: boolean }>;
  resolveAccount?: (cfg: OpenClawConfig, accountId: string) => unknown;
}): ChannelPlugin {
  return {
    id: "telegram",
    gateway: {
      logoutAccount:
        params?.logoutAccount ??
        (async () => ({
          cleared: true,
          loggedOut: true,
        })),
    },
    config: {
      listAccountIds: () => ["default"],
      resolveAccount: params?.resolveAccount ?? ((_cfg, _accountId) => ({ id: "resolved" })),
    },
  } as unknown as ChannelPlugin;
}

describe("logoutChannelAccount", () => {
  const staleCfg = {
    channels: {
      telegram: { botToken: "123:abc" },
    },
  } as OpenClawConfig;
  const freshCfg = {
    channels: {
      telegram: { botToken: "123:abc" },
    },
    mcp: {
      servers: {
        docs: { command: "uvx", args: ["mcp-server"] },
      },
    },
  } as OpenClawConfig;

  beforeEach(() => {
    mocks.readConfigFileSnapshot.mockReset();
    mocks.readConfigFileSnapshot.mockResolvedValue({
      valid: true,
      config: freshCfg,
    });
  });

  it("re-reads config after stopChannel before logout persist", async () => {
    const callOrder: string[] = [];
    const seen: { cfg?: OpenClawConfig } = {};
    const plugin = createPlugin({
      logoutAccount: async ({ cfg }) => {
        callOrder.push("logout");
        seen.cfg = cfg;
        return { cleared: true, loggedOut: true };
      },
    });
    const context = {
      stopChannel: async () => {
        callOrder.push("stop");
      },
      markChannelLoggedOut: vi.fn(),
    } as unknown as GatewayRequestContext;

    const payload = await logoutChannelAccount({
      channelId: "telegram",
      cfg: staleCfg,
      context,
      plugin,
    });

    expect(callOrder).toEqual(["stop", "logout"]);
    expect(mocks.readConfigFileSnapshot).toHaveBeenCalledTimes(1);
    expect(seen.cfg).toBe(freshCfg);
    expect(seen.cfg?.mcp).toEqual(freshCfg.mcp);
    expect(payload.cleared).toBe(true);
    expect(context.markChannelLoggedOut).toHaveBeenCalledWith("telegram", true, "default");
  });

  it("preserves concurrent keys written while the channel is stopping", async () => {
    const seen: { cfg?: OpenClawConfig } = {};
    const plugin = createPlugin({
      logoutAccount: async ({ cfg }) => {
        seen.cfg = cfg;
        return { cleared: true, loggedOut: true };
      },
    });
    const context = {
      stopChannel: async () => {
        mocks.readConfigFileSnapshot.mockResolvedValue({
          valid: true,
          config: freshCfg,
        });
      },
      markChannelLoggedOut: vi.fn(),
    } as unknown as GatewayRequestContext;

    mocks.readConfigFileSnapshot.mockResolvedValue({
      valid: true,
      config: staleCfg,
    });

    await logoutChannelAccount({
      channelId: "telegram",
      cfg: staleCfg,
      context,
      plugin,
    });

    expect(seen.cfg?.mcp?.servers?.docs).toEqual({ command: "uvx", args: ["mcp-server"] });
    expect(seen.cfg?.channels?.telegram?.botToken).toBe("123:abc");
  });

  it("falls back to the pre-stop snapshot when the fresh config is invalid", async () => {
    const seen: { cfg?: OpenClawConfig } = {};
    const plugin = createPlugin({
      logoutAccount: async ({ cfg }) => {
        seen.cfg = cfg;
        return { cleared: true, loggedOut: true };
      },
    });
    mocks.readConfigFileSnapshot.mockResolvedValue({
      valid: false,
      config: freshCfg,
    });
    const context = {
      stopChannel: async () => {},
      markChannelLoggedOut: vi.fn(),
    } as unknown as GatewayRequestContext;

    await logoutChannelAccount({
      channelId: "telegram",
      cfg: staleCfg,
      context,
      plugin,
    });

    expect(seen.cfg).toBe(staleCfg);
  });
});
