import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  drainFileLockStateForTest,
  resetFileLockStateForTest,
  withFileLock,
  type FileLockOptions,
} from "./file-lock.js";

const LOCK_OPTIONS: FileLockOptions = {
  retries: {
    retries: 40,
    factor: 1.2,
    minTimeout: 5,
    maxTimeout: 50,
    randomize: false,
  },
  stale: 5_000,
};

async function withTempFile(fn: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-file-lock-"));
  const filePath = path.join(dir, "target.json");
  await fs.writeFile(filePath, "{}\n", "utf8");
  try {
    await fn(filePath);
  } finally {
    resetFileLockStateForTest();
    await drainFileLockStateForTest();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

afterEach(async () => {
  resetFileLockStateForTest();
  await drainFileLockStateForTest();
});

describe("withFileLock", () => {
  it("serializes concurrent same-process lock holders", async () => {
    await withTempFile(async (filePath) => {
      const events: string[] = [];

      const first = withFileLock(filePath, LOCK_OPTIONS, async () => {
        events.push("a-enter");
        await new Promise((r) => setTimeout(r, 40));
        events.push("a-exit");
      });

      const second = (async () => {
        await new Promise((r) => setTimeout(r, 10));
        await withFileLock(filePath, LOCK_OPTIONS, async () => {
          events.push("b-enter");
        });
        events.push("b-exit");
      })();

      await Promise.all([first, second]);
      expect(events).toEqual(["a-enter", "a-exit", "b-enter", "b-exit"]);
    });
  });

  it("allows nested withFileLock in the same async context", async () => {
    await withTempFile(async (filePath) => {
      const events: string[] = [];
      await withFileLock(filePath, LOCK_OPTIONS, async () => {
        events.push("outer");
        await withFileLock(filePath, LOCK_OPTIONS, async () => {
          events.push("inner");
        });
        events.push("after-inner");
      });
      expect(events).toEqual(["outer", "inner", "after-inner"]);
    });
  });
});
