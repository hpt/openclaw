import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFileLockStateForTest } from "../../infra/file-lock.js";
import { captureEnv } from "../../test-utils/env.js";
import {
  clearRuntimeAuthProfileStoreSnapshots,
  ensureAuthProfileStore,
  replaceRuntimeAuthProfileStoreSnapshots,
  saveAuthProfileStore,
} from "./store.js";
import type { AuthProfileStore } from "./types.js";

let resolveApiKeyForProfile: typeof import("./oauth.js").resolveApiKeyForProfile;

const { getOAuthApiKeyMock } = vi.hoisted(() => ({
  getOAuthApiKeyMock: vi.fn(async () => {
    throw new Error("stale refresh should not run");
  }),
}));

const {
  refreshProviderOAuthCredentialWithPluginMock,
  formatProviderAuthProfileApiKeyWithPluginMock,
  buildProviderAuthDoctorHintWithPluginMock,
} = vi.hoisted(() => ({
  refreshProviderOAuthCredentialWithPluginMock: vi.fn(
    async (_params?: { context?: unknown }) => undefined,
  ),
  formatProviderAuthProfileApiKeyWithPluginMock: vi.fn(() => undefined),
  buildProviderAuthDoctorHintWithPluginMock: vi.fn(async () => undefined),
}));

vi.mock("../cli-credentials.js", () => ({
  readCodexCliCredentialsCached: () => null,
  readQwenCliCredentialsCached: () => null,
  readMiniMaxCliCredentialsCached: () => null,
  resetCliCredentialCachesForTest: () => undefined,
}));

vi.mock("@mariozechner/pi-ai/oauth", async () => {
  const actual = await vi.importActual<typeof import("@mariozechner/pi-ai/oauth")>(
    "@mariozechner/pi-ai/oauth",
  );
  return {
    ...actual,
    getOAuthApiKey: getOAuthApiKeyMock,
    getOAuthProviders: () => [
      { id: "openai-codex", envApiKey: "OPENAI_API_KEY", oauthTokenEnv: "OPENAI_OAUTH_TOKEN" }, // pragma: allowlist secret
    ],
  };
});

vi.mock("../../plugins/provider-runtime.runtime.js", () => ({
  refreshProviderOAuthCredentialWithPlugin: refreshProviderOAuthCredentialWithPluginMock,
  formatProviderAuthProfileApiKeyWithPlugin: formatProviderAuthProfileApiKeyWithPluginMock,
  buildProviderAuthDoctorHintWithPlugin: buildProviderAuthDoctorHintWithPluginMock,
}));

async function loadFreshOAuthModuleForTest() {
  vi.resetModules();
  ({ resolveApiKeyForProfile } = await import("./oauth.js"));
}

describe("oauth refresh under stale runtime snapshot", () => {
  const envSnapshot = captureEnv([
    "OPENCLAW_STATE_DIR",
    "OPENCLAW_AGENT_DIR",
    "PI_CODING_AGENT_DIR",
  ]);
  let tempRoot = "";
  let agentDir = "";

  beforeEach(async () => {
    resetFileLockStateForTest();
    getOAuthApiKeyMock.mockClear();
    refreshProviderOAuthCredentialWithPluginMock.mockReset();
    refreshProviderOAuthCredentialWithPluginMock.mockResolvedValue(undefined);
    formatProviderAuthProfileApiKeyWithPluginMock.mockReset();
    formatProviderAuthProfileApiKeyWithPluginMock.mockReturnValue(undefined);
    buildProviderAuthDoctorHintWithPluginMock.mockReset();
    buildProviderAuthDoctorHintWithPluginMock.mockResolvedValue(undefined);
    clearRuntimeAuthProfileStoreSnapshots();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-oauth-stale-snap-"));
    agentDir = path.join(tempRoot, "agents", "main", "agent");
    await fs.mkdir(agentDir, { recursive: true });
    process.env.OPENCLAW_STATE_DIR = tempRoot;
    process.env.OPENCLAW_AGENT_DIR = agentDir;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    await loadFreshOAuthModuleForTest();
  });

  afterEach(async () => {
    resetFileLockStateForTest();
    clearRuntimeAuthProfileStoreSnapshots();
    envSnapshot.restore();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("does not overwrite fresher on-disk credentials when refreshing under a stale runtime snapshot", async () => {
    const profileId = "openai-codex:default";
    const staleExpiry = Date.now() - 60_000;
    const freshExpiry = Date.now() + 24 * 60 * 60_000;
    const authPath = path.join(agentDir, "auth-profiles.json");

    const staleStore: AuthProfileStore = {
      version: 1,
      profiles: {
        [profileId]: {
          type: "oauth",
          provider: "openai-codex",
          access: "stale-access",
          refresh: "stale-refresh",
          expires: staleExpiry,
        },
        "openai:default": {
          type: "api_key",
          provider: "openai",
          key: "sk-should-survive",
        },
      },
    };
    saveAuthProfileStore(staleStore, agentDir);

    replaceRuntimeAuthProfileStoreSnapshots([
      {
        agentDir,
        store: ensureAuthProfileStore(agentDir),
      },
    ]);

    // Simulate CLI reauth writing fresher credentials while the gateway still
    // holds the stale startup runtime snapshot.
    await fs.writeFile(
      authPath,
      `${JSON.stringify({
        version: 1,
        profiles: {
          [profileId]: {
            type: "oauth",
            provider: "openai-codex",
            access: "fresh-access",
            refresh: "fresh-refresh",
            expires: freshExpiry,
          },
          "openai:default": {
            type: "api_key",
            provider: "openai",
            key: "sk-should-survive",
          },
        },
      })}\n`,
      "utf8",
    );
    // Ensure mtime advances past any same-millisecond cache key.
    const now = new Date(Date.now() + 1_000);
    await fs.utimes(authPath, now, now);

    const staleRuntimeStore = ensureAuthProfileStore(agentDir);
    expect(staleRuntimeStore.profiles[profileId]).toMatchObject({
      access: "stale-access",
      refresh: "stale-refresh",
    });

    const result = await resolveApiKeyForProfile({
      store: staleRuntimeStore,
      profileId,
      agentDir,
    });

    expect(result).toEqual({
      apiKey: "fresh-access",
      provider: "openai-codex",
      email: undefined,
    });
    expect(getOAuthApiKeyMock).not.toHaveBeenCalled();

    clearRuntimeAuthProfileStoreSnapshots();
    const reloaded = ensureAuthProfileStore(agentDir);
    expect(reloaded.profiles[profileId]).toMatchObject({
      access: "fresh-access",
      refresh: "fresh-refresh",
      expires: freshExpiry,
    });
    expect(reloaded.profiles["openai:default"]).toMatchObject({
      type: "api_key",
      key: "sk-should-survive",
    });
  });
});
