import { withFileLock, type FileLockOptions } from "../infra/file-lock.js";
import { resolveConfigPath } from "./paths.js";

/** Shared lock options for openclaw.json read-modify-write callers. */
export const CONFIG_WRITE_LOCK_OPTIONS: FileLockOptions = {
  retries: {
    retries: 10,
    factor: 2,
    minTimeout: 25,
    maxTimeout: 2_500,
    randomize: true,
  },
  stale: 30_000,
};

/**
 * Serialize config load/mutate/write so createMergePatch(disk, staleFullConfig)
 * cannot wipe concurrent keys (channels, plugins, mcp, etc.).
 */
export async function withConfigWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  return await withFileLock(resolveConfigPath(), CONFIG_WRITE_LOCK_OPTIONS, fn);
}
