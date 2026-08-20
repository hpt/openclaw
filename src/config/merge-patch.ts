import { isDeepStrictEqual } from "node:util";
import { isPlainObject } from "../utils.js";
import { isBlockedObjectKey } from "./prototype-keys.js";
import type { OpenClawConfig } from "./types.js";

type PlainObject = Record<string, unknown>;

type MergePatchOptions = {
  mergeObjectArraysById?: boolean;
};

function isObjectWithStringId(value: unknown): value is Record<string, unknown> & { id: string } {
  if (!isPlainObject(value)) {
    return false;
  }
  return typeof value.id === "string" && value.id.length > 0;
}

/**
 * Merge arrays of object-like entries keyed by `id`.
 *
 * Contract:
 * - Base array must be fully id-keyed; otherwise return undefined (caller should replace).
 * - Patch entries with valid id merge by id (or append when the id is new).
 * - Patch entries without valid id append as-is, avoiding destructive full-array replacement.
 */
function mergeObjectArraysById(
  base: unknown[],
  patch: unknown[],
  options: MergePatchOptions,
): unknown[] | undefined {
  if (!base.every(isObjectWithStringId)) {
    return undefined;
  }

  const merged: unknown[] = [...base];
  const indexById = new Map<string, number>();
  for (const [index, entry] of merged.entries()) {
    if (!isObjectWithStringId(entry)) {
      return undefined;
    }
    indexById.set(entry.id, index);
  }

  for (const patchEntry of patch) {
    if (!isObjectWithStringId(patchEntry)) {
      merged.push(structuredClone(patchEntry));
      continue;
    }

    const existingIndex = indexById.get(patchEntry.id);
    if (existingIndex === undefined) {
      merged.push(structuredClone(patchEntry));
      indexById.set(patchEntry.id, merged.length - 1);
      continue;
    }

    merged[existingIndex] = applyMergePatch(merged[existingIndex], patchEntry, options);
  }

  return merged;
}

export function applyMergePatch(
  base: unknown,
  patch: unknown,
  options: MergePatchOptions = {},
): unknown {
  if (!isPlainObject(patch)) {
    return patch;
  }

  const result: PlainObject = isPlainObject(base) ? { ...base } : {};

  for (const [key, value] of Object.entries(patch)) {
    if (isBlockedObjectKey(key)) {
      continue;
    }
    if (value === null) {
      delete result[key];
      continue;
    }
    if (options.mergeObjectArraysById && Array.isArray(result[key]) && Array.isArray(value)) {
      const mergedArray = mergeObjectArraysById(result[key] as unknown[], value, options);
      if (mergedArray) {
        result[key] = mergedArray;
        continue;
      }
    }
    if (isPlainObject(value)) {
      const baseValue = result[key];
      result[key] = applyMergePatch(isPlainObject(baseValue) ? baseValue : {}, value, options);
      continue;
    }
    result[key] = value;
  }

  return result;
}

/**
 * JSON-object check used by createMergePatch. Matches the historical
 * writeConfigFile helper (arrays excluded, host objects treated as objects).
 */
function isMergePatchObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * RFC 7396-style merge patch from `base` to `target`.
 *
 * Keys present on `base` but missing from `target` are nulled so applyMergePatch
 * deletes them. Used by writeConfigFile; callers that pass a stale full config as
 * `target` will wipe concurrent keys that exist only on disk.
 */
export function createMergePatch(base: unknown, target: unknown): unknown {
  if (!isMergePatchObject(base) || !isMergePatchObject(target)) {
    return structuredClone(target);
  }

  const patch: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(target)]);
  for (const key of keys) {
    const hasBase = key in base;
    const hasTarget = key in target;
    if (!hasTarget) {
      patch[key] = null;
      continue;
    }
    const targetValue = target[key];
    if (!hasBase) {
      patch[key] = structuredClone(targetValue);
      continue;
    }
    const baseValue = base[key];
    if (isMergePatchObject(baseValue) && isMergePatchObject(targetValue)) {
      const childPatch = createMergePatch(baseValue, targetValue);
      if (isMergePatchObject(childPatch) && Object.keys(childPatch).length === 0) {
        continue;
      }
      patch[key] = childPatch;
      continue;
    }
    if (!isDeepStrictEqual(baseValue, targetValue)) {
      patch[key] = structuredClone(targetValue);
    }
  }
  return patch;
}

/**
 * Apply local mutations (`baseline` → `mutated`) onto a freshly read config so a
 * later writeConfigFile merge-patch cannot null concurrent keys.
 */
export function mergeConfigMutationsOntoFresh(params: {
  baseline: OpenClawConfig;
  mutated: OpenClawConfig;
  fresh: OpenClawConfig;
}): OpenClawConfig {
  const patch = createMergePatch(params.baseline, params.mutated);
  return applyMergePatch(params.fresh, patch) as OpenClawConfig;
}
