import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withConfigWriteLock, type OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { PluginRuntime } from "../runtime-api.js";
import type { DynamicAgentCreationConfig } from "./types.js";

export type MaybeCreateDynamicAgentResult = {
  created: boolean;
  updatedCfg: OpenClawConfig;
  agentId?: string;
};

/**
 * Check if a dynamic agent should be created for a DM user and create it if needed.
 * This creates a unique agent instance with its own workspace for each DM user.
 */
export async function maybeCreateDynamicAgent(params: {
  cfg: OpenClawConfig;
  runtime: PluginRuntime;
  senderOpenId: string;
  dynamicCfg: DynamicAgentCreationConfig;
  log: (msg: string) => void;
}): Promise<MaybeCreateDynamicAgentResult> {
  const { cfg, runtime, senderOpenId, dynamicCfg, log } = params;

  // Fast path: already bound in the inbound snapshot — no write needed.
  const existingBindings = cfg.bindings ?? [];
  const hasBinding = existingBindings.some(
    (b) =>
      b.match?.channel === "feishu" &&
      b.match?.peer?.kind === "direct" &&
      b.match?.peer?.id === senderOpenId,
  );

  if (hasBinding) {
    return { created: false, updatedCfg: cfg };
  }

  // Use full OpenID as agent ID suffix (OpenID format: ou_xxx is already filesystem-safe)
  const agentId = `feishu-${senderOpenId}`;

  // Resolve path templates with substitutions (idempotent mkdir can happen outside the lock).
  const workspaceTemplate = dynamicCfg.workspaceTemplate ?? "~/.openclaw/workspace-{agentId}";
  const agentDirTemplate = dynamicCfg.agentDirTemplate ?? "~/.openclaw/agents/{agentId}/agent";

  const workspace = resolveUserPath(
    workspaceTemplate.replace("{userId}", senderOpenId).replace("{agentId}", agentId),
  );
  const agentDir = resolveUserPath(
    agentDirTemplate.replace("{userId}", senderOpenId).replace("{agentId}", agentId),
  );

  await fs.promises.mkdir(workspace, { recursive: true });
  await fs.promises.mkdir(agentDir, { recursive: true });

  // Fresh disk read under the shared config lock so concurrent dynamic-agent creates
  // (or other RMW writers) cannot wipe each other's agents/bindings/channels via
  // createMergePatch(disk, staleFullConfig) array replacement.
  return await withConfigWriteLock(async () => {
    const freshCfg = runtime.config.loadConfig();
    const freshBindings = freshCfg.bindings ?? [];
    const alreadyBound = freshBindings.some(
      (b) =>
        b.match?.channel === "feishu" &&
        b.match?.peer?.kind === "direct" &&
        b.match?.peer?.id === senderOpenId,
    );
    if (alreadyBound) {
      return { created: false, updatedCfg: freshCfg };
    }

    if (dynamicCfg.maxAgents !== undefined) {
      const feishuAgentCount = (freshCfg.agents?.list ?? []).filter((a) =>
        a.id.startsWith("feishu-"),
      ).length;
      if (feishuAgentCount >= dynamicCfg.maxAgents) {
        log(
          `feishu: maxAgents limit (${dynamicCfg.maxAgents}) reached, not creating agent for ${senderOpenId}`,
        );
        return { created: false, updatedCfg: freshCfg };
      }
    }

    const existingAgent = (freshCfg.agents?.list ?? []).find((a) => a.id === agentId);
    if (existingAgent) {
      log(`feishu: agent "${agentId}" exists, adding missing binding for ${senderOpenId}`);

      const updatedCfg: OpenClawConfig = {
        ...freshCfg,
        bindings: [
          ...freshBindings,
          {
            agentId,
            match: {
              channel: "feishu",
              peer: { kind: "direct", id: senderOpenId },
            },
          },
        ],
      };

      await runtime.config.writeConfigFile(updatedCfg);
      return { created: true, updatedCfg, agentId };
    }

    log(`feishu: creating dynamic agent "${agentId}" for user ${senderOpenId}`);
    log(`  workspace: ${workspace}`);
    log(`  agentDir: ${agentDir}`);

    const updatedCfg: OpenClawConfig = {
      ...freshCfg,
      agents: {
        ...freshCfg.agents,
        list: [...(freshCfg.agents?.list ?? []), { id: agentId, workspace, agentDir }],
      },
      bindings: [
        ...freshBindings,
        {
          agentId,
          match: {
            channel: "feishu",
            peer: { kind: "direct", id: senderOpenId },
          },
        },
      ],
    };

    await runtime.config.writeConfigFile(updatedCfg);
    return { created: true, updatedCfg, agentId };
  });
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
