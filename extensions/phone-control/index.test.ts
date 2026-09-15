import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/extensions/plugin-api.js";
import registerPhoneControl from "./index.js";
import type {
  OpenClawPluginApi,
  OpenClawPluginCommandDefinition,
  PluginCommandContext,
} from "./runtime-api.js";

const PHONE_CONTROL_STATE_PREFIX = "openclaw-phone-control-test-";
const WRITE_COMMANDS = ["calendar.add", "contacts.add", "reminders.add", "sms.send"] as const;

function createApi(params: {
  stateDir: string;
  getConfig: () => Record<string, unknown>;
  writeConfig: (next: Record<string, unknown>) => Promise<void>;
  registerCommand: (command: OpenClawPluginCommandDefinition) => void;
}): OpenClawPluginApi {
  return createTestPluginApi({
    id: "phone-control",
    name: "phone-control",
    source: "test",
    config: {},
    pluginConfig: {},
    runtime: {
      state: {
        resolveStateDir: () => params.stateDir,
      },
      config: {
        loadConfig: () => params.getConfig(),
        writeConfigFile: (next: Record<string, unknown>) => params.writeConfig(next),
      },
    } as OpenClawPluginApi["runtime"],
    registerCommand: params.registerCommand,
  }) as OpenClawPluginApi;
}

function createCommandContext(
  args: string,
  overrides: Partial<PluginCommandContext> = {},
): PluginCommandContext {
  return {
    channel: "test",
    isAuthorizedSender: true,
    commandBody: `/phone ${args}`,
    args,
    config: {},
    requestConversationBinding: async () => ({
      status: "error",
      message: "unsupported",
    }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
    ...overrides,
  };
}

function createPhoneControlConfig(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gateway: {
      nodes: {
        allowCommands: [],
        denyCommands: [...WRITE_COMMANDS],
      },
    },
    ...extra,
  };
}

async function withRegisteredPhoneControl(
  run: (params: {
    command: OpenClawPluginCommandDefinition;
    writeConfigFile: ReturnType<typeof vi.fn>;
    getConfig: () => Record<string, unknown>;
  }) => Promise<void>,
) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), PHONE_CONTROL_STATE_PREFIX));
  try {
    let config = createPhoneControlConfig();
    const writeConfigFile = vi.fn(async (next: Record<string, unknown>) => {
      config = next;
    });

    let command: OpenClawPluginCommandDefinition | undefined;
    registerPhoneControl.register(
      createApi({
        stateDir,
        getConfig: () => config,
        writeConfig: writeConfigFile,
        registerCommand: (nextCommand) => {
          command = nextCommand;
        },
      }),
    );

    if (!command) {
      throw new Error("phone-control plugin did not register its command");
    }

    await run({
      command,
      writeConfigFile,
      getConfig: () => config,
    });
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

describe("phone-control plugin", () => {
  it("arms sms.send as part of the writes group", async () => {
    await withRegisteredPhoneControl(async ({ command, writeConfigFile, getConfig }) => {
      expect(command.name).toBe("phone");

      const res = await command.handler(createCommandContext("arm writes 30s"));
      const text = String(res?.text ?? "");
      const nodes = (
        getConfig().gateway as { nodes?: { allowCommands?: string[]; denyCommands?: string[] } }
      ).nodes;
      if (!nodes) {
        throw new Error("phone-control command did not persist gateway node config");
      }

      expect(writeConfigFile).toHaveBeenCalledTimes(1);
      expect(nodes.allowCommands).toEqual([...WRITE_COMMANDS]);
      expect(nodes.denyCommands).toEqual([]);
      expect(text).toContain("sms.send");
    });
  });

  it("blocks internal operator.write callers from mutating phone control", async () => {
    await withRegisteredPhoneControl(async ({ command, writeConfigFile }) => {
      const res = await command.handler({
        ...createCommandContext("arm writes 30s"),
        channel: "webchat",
        gatewayClientScopes: ["operator.write"],
      });

      expect(String(res?.text ?? "")).toContain("requires operator.admin");
      expect(writeConfigFile).not.toHaveBeenCalled();
    });
  });

  it("allows internal operator.admin callers to mutate phone control", async () => {
    await withRegisteredPhoneControl(async ({ command, writeConfigFile }) => {
      const res = await command.handler({
        ...createCommandContext("arm writes 30s"),
        channel: "webchat",
        gatewayClientScopes: ["operator.admin"],
      });

      expect(String(res?.text ?? "")).toContain("sms.send");
      expect(writeConfigFile).toHaveBeenCalledTimes(1);
    });
  });

  it("blocks telegram callers when configWrites is disabled", async () => {
    await withRegisteredPhoneControl(async ({ command, writeConfigFile, getConfig }) => {
      Object.assign(
        getConfig(),
        createPhoneControlConfig({
          channels: { telegram: { configWrites: false } },
        }),
      );

      const res = await command.handler(
        createCommandContext("arm writes 30s", {
          channel: "telegram",
          channelId: "telegram",
        }),
      );

      expect(String(res?.text ?? "")).toContain("Config writes are disabled");
      expect(String(res?.text ?? "")).toContain("channels.telegram.configWrites=true");
      expect(writeConfigFile).not.toHaveBeenCalled();
    });
  });

  it("blocks telegram disarm when configWrites is disabled", async () => {
    await withRegisteredPhoneControl(async ({ command, writeConfigFile, getConfig }) => {
      const armRes = await command.handler(createCommandContext("arm writes 30s"));
      expect(String(armRes?.text ?? "")).toContain("sms.send");
      expect(writeConfigFile).toHaveBeenCalledTimes(1);

      Object.assign(getConfig(), {
        channels: { telegram: { configWrites: false } },
      });

      const res = await command.handler(
        createCommandContext("disarm", {
          channel: "telegram",
          channelId: "telegram",
        }),
      );

      expect(String(res?.text ?? "")).toContain("Config writes are disabled");
      expect(writeConfigFile).toHaveBeenCalledTimes(1);
      const nodes = (
        getConfig().gateway as { nodes?: { allowCommands?: string[]; denyCommands?: string[] } }
      ).nodes;
      expect(nodes?.allowCommands).toEqual([...WRITE_COMMANDS]);
      expect(nodes?.denyCommands).toEqual([]);
    });
  });

  it("allows internal operator.admin callers even when webchat configWrites is disabled", async () => {
    await withRegisteredPhoneControl(async ({ command, writeConfigFile, getConfig }) => {
      Object.assign(
        getConfig(),
        createPhoneControlConfig({
          channels: { webchat: { configWrites: false } },
        }),
      );

      const res = await command.handler(
        createCommandContext("arm writes 30s", {
          channel: "webchat",
          channelId: "webchat",
          gatewayClientScopes: ["operator.admin"],
        }),
      );

      expect(String(res?.text ?? "")).toContain("sms.send");
      expect(writeConfigFile).toHaveBeenCalledTimes(1);
    });
  });
});
