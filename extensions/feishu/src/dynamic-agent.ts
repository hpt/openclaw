import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readConfigFileSnapshotForWrite,
  writeConfigFile,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/config-runtime";
import type { PluginRuntime } from "../runtime-api.js";
import type { DynamicAgentCreationConfig } from "./types.js";

export type MaybeCreateDynamicAgentResult = {
  created: boolean;
  updatedCfg: OpenClawConfig;
  agentId?: string;
};

type FeishuBinding = NonNullable<OpenClawConfig["bindings"]>[number];

function isFeishuDmBindingForSender(binding: FeishuBinding, senderOpenId: string): boolean {
  return (
    binding.match?.channel === "feishu" &&
    binding.match?.peer?.kind === "direct" &&
    binding.match?.peer?.id === senderOpenId
  );
}

function hasFeishuDmBinding(cfg: OpenClawConfig, senderOpenId: string): boolean {
  return (cfg.bindings ?? []).some((binding) => isFeishuDmBindingForSender(binding, senderOpenId));
}

function countFeishuDynamicAgents(cfg: OpenClawConfig): number {
  return (cfg.agents?.list ?? []).filter((agent) => agent.id.startsWith("feishu-")).length;
}

function findAgent(cfg: OpenClawConfig, agentId: string) {
  return (cfg.agents?.list ?? []).find((agent) => agent.id === agentId);
}

function buildFeishuDmBinding(agentId: string, senderOpenId: string): FeishuBinding {
  return {
    agentId,
    match: {
      channel: "feishu",
      peer: { kind: "direct", id: senderOpenId },
    },
  };
}

function applyDynamicAgentMutation(
  cfg: OpenClawConfig,
  params: {
    agentId: string;
    senderOpenId: string;
    addAgent?: { workspace: string; agentDir: string };
  },
): OpenClawConfig {
  const next: OpenClawConfig = {
    ...cfg,
    bindings: [...(cfg.bindings ?? []), buildFeishuDmBinding(params.agentId, params.senderOpenId)],
  };
  if (params.addAgent) {
    next.agents = {
      ...cfg.agents,
      list: [
        ...(cfg.agents?.list ?? []),
        {
          id: params.agentId,
          workspace: params.addAgent.workspace,
          agentDir: params.addAgent.agentDir,
        },
      ],
    };
  }
  return next;
}

/**
 * Check if a dynamic agent should be created for a DM user and create it if needed.
 * This creates a unique agent instance with its own workspace for each DM user.
 *
 * Persist overlays the agent/binding onto a fresh disk snapshot. The Feishu monitor
 * reuses the register-time config object, so writing that snapshot would merge-patch
 * null concurrent keys (MCP, other channels, other dynamic agents) added after startup.
 */
export async function maybeCreateDynamicAgent(params: {
  cfg: OpenClawConfig;
  runtime: PluginRuntime;
  senderOpenId: string;
  dynamicCfg: DynamicAgentCreationConfig;
  log: (msg: string) => void;
}): Promise<MaybeCreateDynamicAgentResult> {
  const { cfg, senderOpenId, dynamicCfg, log } = params;

  if (hasFeishuDmBinding(cfg, senderOpenId)) {
    return { created: false, updatedCfg: cfg };
  }

  const agentId = `feishu-${senderOpenId}`;

  let snapshotResult: Awaited<ReturnType<typeof readConfigFileSnapshotForWrite>>;
  try {
    snapshotResult = await readConfigFileSnapshotForWrite();
  } catch (err) {
    log(`feishu: failed to reload config before dynamic agent persist: ${String(err)}`);
    return { created: false, updatedCfg: cfg };
  }

  const { snapshot, writeOptions } = snapshotResult;
  if (!snapshot.exists || !snapshot.valid) {
    log("feishu: skipping dynamic agent persist because the config file is missing or invalid");
    return { created: false, updatedCfg: cfg };
  }

  const freshCfg = structuredClone(snapshot.config ?? {});
  if (hasFeishuDmBinding(freshCfg, senderOpenId)) {
    return { created: false, updatedCfg: freshCfg, agentId };
  }

  if (dynamicCfg.maxAgents !== undefined) {
    const feishuAgentCount = countFeishuDynamicAgents(freshCfg);
    if (feishuAgentCount >= dynamicCfg.maxAgents) {
      log(
        `feishu: maxAgents limit (${dynamicCfg.maxAgents}) reached, not creating agent for ${senderOpenId}`,
      );
      return { created: false, updatedCfg: freshCfg };
    }
  }

  const existingAgent = findAgent(freshCfg, agentId);
  if (existingAgent) {
    log(`feishu: agent "${agentId}" exists, adding missing binding for ${senderOpenId}`);
    const updatedCfg = applyDynamicAgentMutation(freshCfg, { agentId, senderOpenId });
    await writeConfigFile(updatedCfg, writeOptions);
    return { created: true, updatedCfg, agentId };
  }

  const workspaceTemplate = dynamicCfg.workspaceTemplate ?? "~/.openclaw/workspace-{agentId}";
  const agentDirTemplate = dynamicCfg.agentDirTemplate ?? "~/.openclaw/agents/{agentId}/agent";

  const workspace = resolveUserPath(
    workspaceTemplate.replace("{userId}", senderOpenId).replace("{agentId}", agentId),
  );
  const agentDir = resolveUserPath(
    agentDirTemplate.replace("{userId}", senderOpenId).replace("{agentId}", agentId),
  );

  log(`feishu: creating dynamic agent "${agentId}" for user ${senderOpenId}`);
  log(`  workspace: ${workspace}`);
  log(`  agentDir: ${agentDir}`);

  await fs.promises.mkdir(workspace, { recursive: true });
  await fs.promises.mkdir(agentDir, { recursive: true });

  const updatedCfg = applyDynamicAgentMutation(freshCfg, {
    agentId,
    senderOpenId,
    addAgent: { workspace, agentDir },
  });
  await writeConfigFile(updatedCfg, writeOptions);

  return { created: true, updatedCfg, agentId };
}

/**
 * Resolve a path that may start with ~ to the user's home directory.
 */
function resolveUserPath(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
