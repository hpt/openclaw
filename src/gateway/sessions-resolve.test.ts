import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import { resolveSessionKeyFromResolveParams } from "./sessions-resolve.js";

async function withSessionStore(
  store: Record<string, SessionEntry>,
  run: (cfg: OpenClawConfig) => Promise<void>,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-sessions-resolve-"));
  try {
    const storePath = path.join(dir, "sessions.json");
    await fs.writeFile(storePath, JSON.stringify(store), "utf8");
    await run({ session: { store: storePath } } as OpenClawConfig);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("resolveSessionKeyFromResolveParams", () => {
  test("applies spawnedBy scope when resolving direct keys", async () => {
    await withSessionStore(
      {
        "agent:main:acp:owned": {
          sessionId: "sess-owned",
          updatedAt: 1,
          spawnedBy: "agent:main:main",
        },
        "agent:main:acp:other": {
          sessionId: "sess-other",
          updatedAt: 1,
          spawnedBy: "agent:main:subagent:other-parent",
        },
        "agent:main:acp:parent-owned": {
          sessionId: "sess-parent-owned",
          updatedAt: 1,
          parentSessionKey: "agent:main:main",
        },
      },
      async (cfg) => {
        await expect(
          resolveSessionKeyFromResolveParams({
            cfg,
            p: { key: "agent:main:acp:owned", spawnedBy: "agent:main:main" },
          }),
        ).resolves.toEqual({ ok: true, key: "agent:main:acp:owned" });

        await expect(
          resolveSessionKeyFromResolveParams({
            cfg,
            p: { key: "agent:main:acp:parent-owned", spawnedBy: "agent:main:main" },
          }),
        ).resolves.toEqual({ ok: true, key: "agent:main:acp:parent-owned" });

        const mismatched = await resolveSessionKeyFromResolveParams({
          cfg,
          p: { key: "agent:main:acp:other", spawnedBy: "agent:main:main" },
        });
        expect(mismatched.ok).toBe(false);
        if (!mismatched.ok) {
          expect(mismatched.error.message).toContain("No session found");
        }
      },
    );
  });
});
