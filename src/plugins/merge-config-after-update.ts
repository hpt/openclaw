import type { OpenClawConfig } from "../config/config.js";

/**
 * Overlay plugin/hook install mutations from a long-running update onto a fresh
 * disk snapshot so writeConfigFile's createMergePatch cannot wipe concurrent
 * channel/MCP/plugin keys held only in the pre-update snapshot.
 */
export function mergePluginUpdateConfigOntoFresh(params: {
  baseline: OpenClawConfig;
  updated: OpenClawConfig;
  fresh: OpenClawConfig;
}): OpenClawConfig {
  const { baseline, updated, fresh } = params;

  const next: OpenClawConfig = { ...fresh };

  const baselineInstalls = baseline.plugins?.installs ?? {};
  const updatedInstalls = updated.plugins?.installs ?? {};
  const mergedInstalls = { ...fresh.plugins?.installs };

  for (const [pluginId, record] of Object.entries(updatedInstalls)) {
    if (baselineInstalls[pluginId] !== record) {
      mergedInstalls[pluginId] = record;
    }
  }
  for (const pluginId of Object.keys(baselineInstalls)) {
    if (!(pluginId in updatedInstalls)) {
      delete mergedInstalls[pluginId];
    }
  }

  const plugins: NonNullable<OpenClawConfig["plugins"]> = {
    ...fresh.plugins,
    installs: mergedInstalls,
  };

  // ID migration may rewrite entries / allow / deny / slots / load paths.
  if (updated.plugins?.entries !== baseline.plugins?.entries) {
    plugins.entries = overlayRecordMap(
      baseline.plugins?.entries,
      updated.plugins?.entries,
      fresh.plugins?.entries,
    );
  }
  if (updated.plugins?.allow !== baseline.plugins?.allow) {
    plugins.allow = updated.plugins?.allow;
  }
  if (updated.plugins?.deny !== baseline.plugins?.deny) {
    plugins.deny = updated.plugins?.deny;
  }
  if (updated.plugins?.slots !== baseline.plugins?.slots) {
    plugins.slots = {
      ...fresh.plugins?.slots,
      ...updated.plugins?.slots,
    };
  }
  if (updated.plugins?.load !== baseline.plugins?.load) {
    plugins.load = updated.plugins?.load
      ? {
          ...fresh.plugins?.load,
          ...updated.plugins.load,
        }
      : fresh.plugins?.load;
  }

  next.plugins = plugins;

  const baselineHookInstalls = baseline.hooks?.internal?.installs ?? {};
  const updatedHookInstalls = updated.hooks?.internal?.installs ?? {};
  const mergedHookInstalls = { ...fresh.hooks?.internal?.installs };

  for (const [hookId, record] of Object.entries(updatedHookInstalls)) {
    if (baselineHookInstalls[hookId] !== record) {
      mergedHookInstalls[hookId] = record;
    }
  }
  for (const hookId of Object.keys(baselineHookInstalls)) {
    if (!(hookId in updatedHookInstalls)) {
      delete mergedHookInstalls[hookId];
    }
  }

  if (updated.hooks?.internal?.installs !== baseline.hooks?.internal?.installs) {
    next.hooks = {
      ...fresh.hooks,
      internal: {
        ...fresh.hooks?.internal,
        installs: mergedHookInstalls,
      },
    };
  }

  return next;
}

function overlayRecordMap<T>(
  baseline: Record<string, T> | undefined,
  updated: Record<string, T> | undefined,
  fresh: Record<string, T> | undefined,
): Record<string, T> | undefined {
  if (!updated) {
    return fresh;
  }
  const base = baseline ?? {};
  const merged = { ...fresh };
  for (const [key, value] of Object.entries(updated)) {
    if (base[key] !== value) {
      merged[key] = value;
    }
  }
  for (const key of Object.keys(base)) {
    if (!(key in updated)) {
      delete merged[key];
    }
  }
  return merged;
}
