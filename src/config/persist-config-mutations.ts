import { readConfigFileSnapshotForWrite, writeConfigFile, type OpenClawConfig } from "./config.js";
import { mergeConfigMutationsOntoFresh } from "./merge-patch.js";

/**
 * Persist caller mutations without wiping keys added to disk after `baseline`
 * was loaded. `writeConfigFile` merge-patches against current disk, and a stale
 * full snapshot treats concurrent keys as deletions.
 */
export async function writeConfigFilePreservingConcurrentKeys(params: {
  baseline: OpenClawConfig;
  mutated: OpenClawConfig;
}): Promise<OpenClawConfig> {
  const { snapshot } = await readConfigFileSnapshotForWrite();
  const next =
    snapshot.valid && snapshot.exists
      ? mergeConfigMutationsOntoFresh({
          baseline: params.baseline,
          mutated: params.mutated,
          fresh: snapshot.config,
        })
      : params.mutated;
  await writeConfigFile(next);
  return next;
}
