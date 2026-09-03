import { readConfigFileSnapshotForWrite, writeConfigFile } from "./io.js";
import { mergeConfigMutationsOntoFresh } from "./merge-patch.js";
import type { OpenClawConfig } from "./types.js";

/**
 * Persist intended mutations from a long-lived config snapshot without
 * merge-patch-deleting keys that landed on disk after `baseline` was loaded.
 *
 * `writeConfigFile(staleFullConfig)` computes `createMergePatch(freshDisk, stale)`
 * and treats missing keys as deletes. Overlaying only the baseline→next delta
 * onto a fresh snapshot keeps concurrent writers' keys.
 */
export async function writeConfigFilePreservingConcurrentKeys(params: {
  baseline: OpenClawConfig;
  next: OpenClawConfig;
}): Promise<OpenClawConfig> {
  const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
  if (!snapshot.valid) {
    await writeConfigFile(params.next);
    return params.next;
  }
  const overlaid = mergeConfigMutationsOntoFresh({
    fresh: snapshot.config,
    baseline: params.baseline,
    next: params.next,
  });
  await writeConfigFile(overlaid, writeOptions);
  return overlaid;
}
