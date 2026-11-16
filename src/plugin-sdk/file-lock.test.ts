import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireFileLock, resetFileLockStateForTest, type FileLockOptions } from "./file-lock.js";

const tmpRoots: string[] = [];

const FAST_LOCK_OPTIONS: FileLockOptions = {
  retries: {
    retries: 1,
    factor: 1,
    minTimeout: 1,
    maxTimeout: 5,
  },
  stale: 1_000,
};

async function makeTmpRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-file-lock-"));
  tmpRoots.push(root);
  return root;
}

async function writeLockFile(lockPath: string, payload: unknown): Promise<void> {
  await fs.writeFile(lockPath, `${JSON.stringify(payload)}\n`, "utf8");
}

afterEach(async () => {
  resetFileLockStateForTest();
  await Promise.all(
    tmpRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("acquireFileLock stale reclaim", () => {
  it("does not steal a lock still owned by a live process", async () => {
    const root = await makeTmpRoot();
    const target = path.join(root, "auth-profiles.json");
    const lockPath = `${target}.lock`;
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    await writeLockFile(lockPath, { pid: process.pid, createdAt });

    await expect(acquireFileLock(target, FAST_LOCK_OPTIONS)).rejects.toThrow(/file lock timeout/);

    const preserved = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
      pid?: number;
      createdAt?: string;
    };
    expect(preserved.pid).toBe(process.pid);
    expect(preserved.createdAt).toBe(createdAt);
  });

  it("reclaims a lock whose owner pid is dead", async () => {
    const root = await makeTmpRoot();
    const target = path.join(root, "auth-profiles.json");
    const lockPath = `${target}.lock`;
    await writeLockFile(lockPath, {
      pid: 2_147_483_646,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const lock = await acquireFileLock(target, FAST_LOCK_OPTIONS);
    const replaced = JSON.parse(await fs.readFile(lockPath, "utf8")) as { pid?: number };
    expect(replaced.pid).toBe(process.pid);
    await lock.release();
    await expect(fs.access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reclaims a payload-less lock only after it is older than stale", async () => {
    const root = await makeTmpRoot();
    const target = path.join(root, "auth-profiles.json");
    const lockPath = `${target}.lock`;
    await fs.writeFile(lockPath, "not-json", "utf8");

    await expect(acquireFileLock(target, FAST_LOCK_OPTIONS)).rejects.toThrow(/file lock timeout/);

    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lockPath, old, old);
    const lock = await acquireFileLock(target, FAST_LOCK_OPTIONS);
    const replaced = JSON.parse(await fs.readFile(lockPath, "utf8")) as { pid?: number };
    expect(replaced.pid).toBe(process.pid);
    await lock.release();
  });
});
