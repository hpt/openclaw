import {
  readConfigFileSnapshotForWrite,
  writeConfigFile,
  type OpenClawConfig,
} from "../config/config.js";
import type { ConfigWriteOptions, ReadConfigFileSnapshotForWriteResult } from "../config/io.js";
import { mergeConfigMutationsOntoFresh } from "../config/merge-patch.js";
import type { GatewayAuthMode } from "../config/types.gateway.js";

export function overlayGatewayAuthToken(params: {
  cfg: OpenClawConfig;
  token: string;
  mode?: GatewayAuthMode;
}): OpenClawConfig {
  return {
    ...params.cfg,
    gateway: {
      ...params.cfg.gateway,
      auth: {
        ...params.cfg.gateway?.auth,
        mode: params.mode ?? params.cfg.gateway?.auth?.mode ?? "token",
        token: params.token,
      },
    },
  };
}

type PersistDoctorConfigMutationsParams = {
  baseline: OpenClawConfig;
  mutated: OpenClawConfig;
  readSnapshot?: () => Promise<ReadConfigFileSnapshotForWriteResult>;
  writeConfig?: (cfg: OpenClawConfig, options?: ConfigWriteOptions) => Promise<void>;
};

/**
 * Persist doctor mutations against a fresh on-disk snapshot.
 *
 * Doctor holds an in-memory config across health checks, prompts, daemon
 * repair, and service-token writes. Writing that stale full config lets
 * writeConfigFile's merge-patch null concurrent keys (and even doctor's own
 * earlier gateway.auth.token persist).
 */
export async function persistDoctorConfigMutations(
  params: PersistDoctorConfigMutationsParams,
): Promise<OpenClawConfig> {
  const readSnapshot = params.readSnapshot ?? readConfigFileSnapshotForWrite;
  const writeConfig = params.writeConfig ?? writeConfigFile;
  const { snapshot, writeOptions } = await readSnapshot();
  const next = snapshot.valid
    ? mergeConfigMutationsOntoFresh({
        baseline: params.baseline,
        mutated: params.mutated,
        fresh: snapshot.config,
      })
    : params.mutated;
  await writeConfig(next, writeOptions);
  return next;
}

type PersistGatewayAuthTokenParams = {
  cfg: OpenClawConfig;
  token: string;
  mode?: GatewayAuthMode;
  readSnapshot?: () => Promise<ReadConfigFileSnapshotForWriteResult>;
  writeConfig?: (cfg: OpenClawConfig, options?: ConfigWriteOptions) => Promise<void>;
};

/**
 * Persist a recovered gateway auth token onto a fresh snapshot so the service
 * repair write cannot wipe concurrent channel/plugin/MCP keys.
 */
export async function persistGatewayAuthToken(
  params: PersistGatewayAuthTokenParams,
): Promise<OpenClawConfig> {
  const readSnapshot = params.readSnapshot ?? readConfigFileSnapshotForWrite;
  const writeConfig = params.writeConfig ?? writeConfigFile;
  const { snapshot, writeOptions } = await readSnapshot();
  const base = snapshot.valid ? snapshot.config : params.cfg;
  const next = overlayGatewayAuthToken({
    cfg: base,
    token: params.token,
    mode: params.mode,
  });
  await writeConfig(next, writeOptions);
  return next;
}
