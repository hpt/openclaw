import type { OpenClawConfig } from "../config/config.js";
import { readConfigFileSnapshotForWrite, writeConfigFile } from "../config/config.js";
import { type HookInstallUpdate, recordHookInstall } from "../hooks/installs.js";
import { enablePluginInConfig } from "../plugins/enable.js";
import { type PluginInstallUpdate, recordPluginInstall } from "../plugins/installs.js";
import { defaultRuntime } from "../runtime.js";
import { theme } from "../terminal/theme.js";
import {
  applySlotSelectionForPlugin,
  enableInternalHookEntries,
  logHookPackRestartHint,
  logSlotWarnings,
} from "./plugins-command-helpers.js";

export async function persistPluginInstall(params: {
  config: OpenClawConfig;
  pluginId: string;
  install: Omit<PluginInstallUpdate, "pluginId">;
  successMessage?: string;
  warningMessage?: string;
}): Promise<OpenClawConfig> {
  // Install I/O (npm/marketplace download) happens before this persist call.
  // Re-read disk so createMergePatch cannot wipe concurrent channel/MCP keys
  // from the pre-install snapshot. Fall back to params.config when the on-disk
  // snapshot is invalid (e.g. Matrix recovery cleanup still only in memory).
  const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
  const base = snapshot.valid ? snapshot.config : params.config;
  let next = enablePluginInConfig(base, params.pluginId).config;
  next = recordPluginInstall(next, {
    pluginId: params.pluginId,
    ...params.install,
  });
  const slotResult = applySlotSelectionForPlugin(next, params.pluginId);
  next = slotResult.config;
  await writeConfigFile(next, writeOptions);
  logSlotWarnings(slotResult.warnings);
  if (params.warningMessage) {
    defaultRuntime.log(theme.warn(params.warningMessage));
  }
  defaultRuntime.log(params.successMessage ?? `Installed plugin: ${params.pluginId}`);
  defaultRuntime.log("Restart the gateway to load plugins.");
  return next;
}

export async function persistHookPackInstall(params: {
  config: OpenClawConfig;
  hookPackId: string;
  hooks: string[];
  install: Omit<HookInstallUpdate, "hookId" | "hooks">;
  successMessage?: string;
}): Promise<OpenClawConfig> {
  const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
  const base = snapshot.valid ? snapshot.config : params.config;
  let next = enableInternalHookEntries(base, params.hooks);
  next = recordHookInstall(next, {
    hookId: params.hookPackId,
    hooks: params.hooks,
    ...params.install,
  });
  await writeConfigFile(next, writeOptions);
  defaultRuntime.log(params.successMessage ?? `Installed hook pack: ${params.hookPackId}`);
  logHookPackRestartHint();
  return next;
}
