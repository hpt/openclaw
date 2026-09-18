import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTempDir } from "./exec-approvals-test-helpers.js";

const requestJsonlSocketMock = vi.hoisted(() => vi.fn());

vi.mock("./jsonl-socket.js", () => ({
  requestJsonlSocket: (...args: unknown[]) => requestJsonlSocketMock(...args),
}));

import type { ExecApprovalsFile } from "./exec-approvals.js";

type ExecApprovalsModule = typeof import("./exec-approvals.js");

let addAllowlistEntry: ExecApprovalsModule["addAllowlistEntry"];
let ensureExecApprovals: ExecApprovalsModule["ensureExecApprovals"];
let mergeExecApprovalsSocketDefaults: ExecApprovalsModule["mergeExecApprovalsSocketDefaults"];
let normalizeExecApprovals: ExecApprovalsModule["normalizeExecApprovals"];
let readExecApprovalsSnapshot: ExecApprovalsModule["readExecApprovalsSnapshot"];
let recordAllowlistUse: ExecApprovalsModule["recordAllowlistUse"];
let requestExecApprovalViaSocket: ExecApprovalsModule["requestExecApprovalViaSocket"];
let resolveExecApprovalsPath: ExecApprovalsModule["resolveExecApprovalsPath"];
let resolveExecApprovalsSocketPath: ExecApprovalsModule["resolveExecApprovalsSocketPath"];
let saveExecApprovals: ExecApprovalsModule["saveExecApprovals"];

const tempDirs: string[] = [];
const originalOpenClawHome = process.env.OPENCLAW_HOME;

beforeEach(async () => {
  vi.resetModules();
  ({
    addAllowlistEntry,
    ensureExecApprovals,
    mergeExecApprovalsSocketDefaults,
    normalizeExecApprovals,
    readExecApprovalsSnapshot,
    recordAllowlistUse,
    requestExecApprovalViaSocket,
    resolveExecApprovalsPath,
    resolveExecApprovalsSocketPath,
    saveExecApprovals,
  } = await import("./exec-approvals.js"));
  requestJsonlSocketMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalOpenClawHome === undefined) {
    delete process.env.OPENCLAW_HOME;
  } else {
    process.env.OPENCLAW_HOME = originalOpenClawHome;
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createHomeDir(): string {
  const dir = makeTempDir();
  tempDirs.push(dir);
  process.env.OPENCLAW_HOME = dir;
  return dir;
}

function approvalsFilePath(homeDir: string): string {
  return path.join(homeDir, ".openclaw", "exec-approvals.json");
}

function readApprovalsFile(homeDir: string): ExecApprovalsFile {
  return JSON.parse(fs.readFileSync(approvalsFilePath(homeDir), "utf8")) as ExecApprovalsFile;
}

describe("exec approvals store helpers", () => {
  it("expands home-prefixed default file and socket paths", () => {
    const dir = createHomeDir();

    expect(path.normalize(resolveExecApprovalsPath())).toBe(
      path.normalize(path.join(dir, ".openclaw", "exec-approvals.json")),
    );
    expect(path.normalize(resolveExecApprovalsSocketPath())).toBe(
      path.normalize(path.join(dir, ".openclaw", "exec-approvals.sock")),
    );
  });

  it("merges socket defaults from normalized, current, and built-in fallback", () => {
    const normalized = normalizeExecApprovals({
      version: 1,
      agents: {},
      socket: { path: "/tmp/a.sock", token: "a" },
    });
    const current = normalizeExecApprovals({
      version: 1,
      agents: {},
      socket: { path: "/tmp/b.sock", token: "b" },
    });

    expect(mergeExecApprovalsSocketDefaults({ normalized, current }).socket).toEqual({
      path: "/tmp/a.sock",
      token: "a",
    });

    const merged = mergeExecApprovalsSocketDefaults({
      normalized: normalizeExecApprovals({ version: 1, agents: {} }),
      current,
    });
    expect(merged.socket).toEqual({
      path: "/tmp/b.sock",
      token: "b",
    });

    createHomeDir();
    expect(
      mergeExecApprovalsSocketDefaults({
        normalized: normalizeExecApprovals({ version: 1, agents: {} }),
      }).socket,
    ).toEqual({
      path: resolveExecApprovalsSocketPath(),
      token: "",
    });
  });

  it("returns normalized empty snapshots for missing and invalid approvals files", () => {
    const dir = createHomeDir();

    const missing = readExecApprovalsSnapshot();
    expect(missing.exists).toBe(false);
    expect(missing.raw).toBeNull();
    expect(missing.file).toEqual(normalizeExecApprovals({ version: 1, agents: {} }));
    expect(path.normalize(missing.path)).toBe(path.normalize(approvalsFilePath(dir)));

    fs.mkdirSync(path.dirname(approvalsFilePath(dir)), { recursive: true });
    fs.writeFileSync(approvalsFilePath(dir), "{invalid", "utf8");

    const invalid = readExecApprovalsSnapshot();
    expect(invalid.exists).toBe(true);
    expect(invalid.raw).toBe("{invalid");
    expect(invalid.file).toEqual(normalizeExecApprovals({ version: 1, agents: {} }));
  });

  it("ensures approvals file with default socket path and generated token", () => {
    const dir = createHomeDir();

    const ensured = ensureExecApprovals();
    const raw = fs.readFileSync(approvalsFilePath(dir), "utf8");

    expect(ensured.socket?.path).toBe(resolveExecApprovalsSocketPath());
    expect(ensured.socket?.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(raw.endsWith("\n")).toBe(true);
    expect(readApprovalsFile(dir).socket).toEqual(ensured.socket);
  });

  it("adds trimmed allowlist entries once and persists generated ids", () => {
    const dir = createHomeDir();
    vi.spyOn(Date, "now").mockReturnValue(123_456);

    const approvals = ensureExecApprovals();
    addAllowlistEntry(approvals, "worker", "  /usr/bin/rg  ");
    addAllowlistEntry(approvals, "worker", "/usr/bin/rg");
    addAllowlistEntry(approvals, "worker", "   ");

    expect(readApprovalsFile(dir).agents?.worker?.allowlist).toEqual([
      expect.objectContaining({
        pattern: "/usr/bin/rg",
        lastUsedAt: 123_456,
      }),
    ]);
    expect(readApprovalsFile(dir).agents?.worker?.allowlist?.[0]?.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("reloads exec-approvals.json before allow-always persist so stale snapshots cannot restore a looser policy", () => {
    const dir = createHomeDir();
    vi.spyOn(Date, "now").mockReturnValue(222_000);

    const stale = ensureExecApprovals();
    stale.defaults = { security: "allowlist", ask: "on-miss" };
    stale.agents = {
      worker: {
        security: "allowlist",
        allowlist: [{ id: "stale-id", pattern: "/usr/bin/old" }],
      },
    };

    saveExecApprovals({
      version: 1,
      socket: stale.socket,
      defaults: { security: "deny", ask: "always" },
      agents: {
        worker: {
          security: "deny",
          allowlist: [{ id: "keep-id", pattern: "/usr/bin/jq" }],
        },
      },
    });

    addAllowlistEntry(stale, "worker", "/usr/bin/rg");

    const persisted = readApprovalsFile(dir);
    expect(persisted.defaults).toEqual({ security: "deny", ask: "always" });
    expect(persisted.agents?.worker?.security).toBe("deny");
    expect(persisted.agents?.worker?.allowlist).toEqual([
      { id: "keep-id", pattern: "/usr/bin/jq" },
      expect.objectContaining({
        pattern: "/usr/bin/rg",
        lastUsedAt: 222_000,
      }),
    ]);
    expect(stale.defaults).toMatchObject({ security: "deny", ask: "always" });
    expect(
      persisted.agents?.worker?.allowlist?.some((entry) => entry.pattern === "/usr/bin/old"),
    ).toBe(false);
  });

  it("reloads exec-approvals.json before last-used persist so stale snapshots cannot drop concurrent allowlist edits", () => {
    const dir = createHomeDir();
    vi.spyOn(Date, "now").mockReturnValue(333_000);

    const stale: ExecApprovalsFile = {
      version: 1,
      defaults: { security: "allowlist" },
      agents: {
        main: {
          allowlist: [{ pattern: "/usr/bin/rg" }],
        },
      },
    };
    fs.mkdirSync(path.dirname(approvalsFilePath(dir)), { recursive: true });
    fs.writeFileSync(
      approvalsFilePath(dir),
      JSON.stringify(
        {
          version: 1,
          defaults: { security: "deny" },
          agents: {
            main: {
              security: "deny",
              allowlist: [
                { pattern: "/usr/bin/rg", id: "rg-id" },
                { pattern: "/usr/bin/jq", id: "jq-id" },
              ],
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    recordAllowlistUse(stale, undefined, { pattern: "/usr/bin/rg" }, "rg needle", "/bin/rg");

    const persisted = readApprovalsFile(dir);
    expect(persisted.defaults?.security).toBe("deny");
    expect(persisted.agents?.main?.security).toBe("deny");
    expect(persisted.agents?.main?.allowlist).toEqual([
      expect.objectContaining({
        pattern: "/usr/bin/rg",
        id: "rg-id",
        lastUsedAt: 333_000,
        lastUsedCommand: "rg needle",
        lastResolvedPath: "/bin/rg",
      }),
      { pattern: "/usr/bin/jq", id: "jq-id" },
    ]);
    expect(stale.defaults?.security).toBe("deny");
  });

  it("records allowlist usage on the matching entry and backfills missing ids", () => {
    const dir = createHomeDir();
    vi.spyOn(Date, "now").mockReturnValue(999_000);

    const approvals: ExecApprovalsFile = {
      version: 1,
      agents: {
        main: {
          allowlist: [{ pattern: "/usr/bin/rg" }, { pattern: "/usr/bin/jq", id: "keep-id" }],
        },
      },
    };
    fs.mkdirSync(path.dirname(approvalsFilePath(dir)), { recursive: true });
    fs.writeFileSync(approvalsFilePath(dir), JSON.stringify(approvals, null, 2), "utf8");

    recordAllowlistUse(
      approvals,
      undefined,
      { pattern: "/usr/bin/rg" },
      "rg needle",
      "/opt/homebrew/bin/rg",
    );

    expect(readApprovalsFile(dir).agents?.main?.allowlist).toEqual([
      expect.objectContaining({
        pattern: "/usr/bin/rg",
        lastUsedAt: 999_000,
        lastUsedCommand: "rg needle",
        lastResolvedPath: "/opt/homebrew/bin/rg",
      }),
      { pattern: "/usr/bin/jq", id: "keep-id" },
    ]);
    expect(readApprovalsFile(dir).agents?.main?.allowlist?.[0]?.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("returns null when approval socket credentials are missing", async () => {
    await expect(
      requestExecApprovalViaSocket({
        socketPath: "",
        token: "secret",
        request: { command: "echo hi" },
      }),
    ).resolves.toBeNull();
    await expect(
      requestExecApprovalViaSocket({
        socketPath: "/tmp/socket",
        token: "",
        request: { command: "echo hi" },
      }),
    ).resolves.toBeNull();
    expect(requestJsonlSocketMock).not.toHaveBeenCalled();
  });

  it("builds approval socket payloads and accepts decision responses only", async () => {
    requestJsonlSocketMock.mockImplementationOnce(async ({ payload, accept, timeoutMs }) => {
      expect(timeoutMs).toBe(15_000);
      const parsed = JSON.parse(payload) as {
        type: string;
        token: string;
        id: string;
        request: { command: string };
      };
      expect(parsed.type).toBe("request");
      expect(parsed.token).toBe("secret");
      expect(parsed.request).toEqual({ command: "echo hi" });
      expect(parsed.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(accept({ type: "noop", decision: "allow-once" })).toBeUndefined();
      expect(accept({ type: "decision", decision: "allow-always" })).toBe("allow-always");
      return "deny";
    });

    await expect(
      requestExecApprovalViaSocket({
        socketPath: "/tmp/socket",
        token: "secret",
        request: { command: "echo hi" },
      }),
    ).resolves.toBe("deny");
  });
});
