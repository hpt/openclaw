import { withFileLock, type FileLockOptions } from "../infra/file-lock.js";
import { readConfigFileSnapshot, writeConfigFile } from "./io.js";
import { resolveConfigPath } from "./paths.js";
import type { OpenClawConfig } from "./types.openclaw.js";
import { validateConfigObjectWithPlugins } from "./validation.js";

export type ConfigMcpServers = Record<string, Record<string, unknown>>;

type ConfigMcpReadResult =
  | { ok: true; path: string; config: OpenClawConfig; mcpServers: ConfigMcpServers }
  | { ok: false; path: string; error: string };

type ConfigMcpWriteResult =
  | {
      ok: true;
      path: string;
      config: OpenClawConfig;
      mcpServers: ConfigMcpServers;
      removed?: boolean;
    }
  | { ok: false; path: string; error: string };

const CONFIG_IO_LOCK_OPTIONS: FileLockOptions = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 25,
    maxTimeout: 2_500,
    randomize: true,
  },
  stale: 30_000,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeConfiguredMcpServers(value: unknown): ConfigMcpServers {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, server]) => isRecord(server))
      .map(([name, server]) => [name, { ...(server as Record<string, unknown>) }]),
  );
}

export async function listConfiguredMcpServers(): Promise<ConfigMcpReadResult> {
  const snapshot = await readConfigFileSnapshot();
  if (!snapshot.valid) {
    return {
      ok: false,
      path: snapshot.path,
      error: "Config file is invalid; fix it before using MCP config commands.",
    };
  }
  return {
    ok: true,
    path: snapshot.path,
    config: structuredClone(snapshot.resolved),
    mcpServers: normalizeConfiguredMcpServers(snapshot.resolved.mcp?.servers),
  };
}

async function mutateConfiguredMcpServers(
  mutate: (params: {
    config: OpenClawConfig;
    servers: ConfigMcpServers;
  }) =>
    | { ok: true; config: OpenClawConfig; servers: ConfigMcpServers; removed?: boolean }
    | { ok: false; error: string }
    | { ok: true; skipped: true; config: OpenClawConfig; servers: ConfigMcpServers },
): Promise<ConfigMcpWriteResult> {
  // Re-read under the shared config lock so concurrent writers (channels, doctor, etc.)
  // cannot be wiped by createMergePatch(disk, staleFullConfig).
  return await withFileLock(resolveConfigPath(), CONFIG_IO_LOCK_OPTIONS, async () => {
    const loaded = await listConfiguredMcpServers();
    if (!loaded.ok) {
      return loaded;
    }

    const nextBase = structuredClone(loaded.config);
    const servers = normalizeConfiguredMcpServers(nextBase.mcp?.servers);
    const mutated = mutate({ config: nextBase, servers });
    if (!mutated.ok) {
      return { ok: false, path: loaded.path, error: mutated.error };
    }
    if ("skipped" in mutated && mutated.skipped) {
      return {
        ok: true,
        path: loaded.path,
        config: mutated.config,
        mcpServers: mutated.servers,
        removed: false,
      };
    }

    const validated = validateConfigObjectWithPlugins(mutated.config);
    if (!validated.ok) {
      const issue = validated.issues[0];
      return {
        ok: false,
        path: loaded.path,
        error: `Config invalid after MCP update (${issue.path}: ${issue.message}).`,
      };
    }
    await writeConfigFile(validated.config);
    return {
      ok: true,
      path: loaded.path,
      config: validated.config,
      mcpServers: mutated.servers,
      ...("removed" in mutated ? { removed: mutated.removed } : {}),
    };
  });
}

export async function setConfiguredMcpServer(params: {
  name: string;
  server: unknown;
}): Promise<ConfigMcpWriteResult> {
  const name = params.name.trim();
  if (!name) {
    return { ok: false, path: "", error: "MCP server name is required." };
  }
  if (!isRecord(params.server)) {
    return { ok: false, path: "", error: "MCP server config must be a JSON object." };
  }
  const server: Record<string, unknown> = { ...params.server };

  return await mutateConfiguredMcpServers(({ config, servers }) => {
    servers[name] = server;
    config.mcp = {
      ...config.mcp,
      servers,
    };
    return { ok: true, config, servers };
  });
}

export async function unsetConfiguredMcpServer(params: {
  name: string;
}): Promise<ConfigMcpWriteResult> {
  const name = params.name.trim();
  if (!name) {
    return { ok: false, path: "", error: "MCP server name is required." };
  }

  return await mutateConfiguredMcpServers(({ config, servers }) => {
    if (!Object.hasOwn(servers, name)) {
      return { ok: true, skipped: true, config, servers };
    }
    delete servers[name];
    if (Object.keys(servers).length > 0) {
      config.mcp = {
        ...config.mcp,
        servers,
      };
    } else if (config.mcp) {
      delete config.mcp.servers;
      if (Object.keys(config.mcp).length === 0) {
        delete config.mcp;
      }
    }
    return { ok: true, config, servers, removed: true };
  });
}
