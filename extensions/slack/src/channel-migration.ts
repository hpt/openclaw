import {
  writeConfigFile,
  type OpenClawConfig,
  type SlackChannelConfig,
} from "openclaw/plugin-sdk/config-runtime";
import { normalizeAccountId } from "openclaw/plugin-sdk/routing";

type SlackChannels = Record<string, SlackChannelConfig>;

type MigrationScope = "account" | "global";

export type SlackChannelMigrationResult = {
  migrated: boolean;
  skippedExisting: boolean;
  scopes: MigrationScope[];
};

function resolveAccountChannels(
  cfg: OpenClawConfig,
  accountId?: string | null,
): { channels?: SlackChannels } {
  if (!accountId) {
    return {};
  }
  const normalized = normalizeAccountId(accountId);
  const accounts = cfg.channels?.slack?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return {};
  }
  const exact = accounts[normalized];
  if (exact?.channels) {
    return { channels: exact.channels };
  }
  const matchKey = Object.keys(accounts).find(
    (key) => key.toLowerCase() === normalized.toLowerCase(),
  );
  return { channels: matchKey ? accounts[matchKey]?.channels : undefined };
}

export function migrateSlackChannelsInPlace(
  channels: SlackChannels | undefined,
  oldChannelId: string,
  newChannelId: string,
): { migrated: boolean; skippedExisting: boolean } {
  if (!channels) {
    return { migrated: false, skippedExisting: false };
  }
  if (oldChannelId === newChannelId) {
    return { migrated: false, skippedExisting: false };
  }
  if (!Object.hasOwn(channels, oldChannelId)) {
    return { migrated: false, skippedExisting: false };
  }
  if (Object.hasOwn(channels, newChannelId)) {
    return { migrated: false, skippedExisting: true };
  }
  channels[newChannelId] = channels[oldChannelId];
  delete channels[oldChannelId];
  return { migrated: true, skippedExisting: false };
}

export function migrateSlackChannelConfig(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  oldChannelId: string;
  newChannelId: string;
}): SlackChannelMigrationResult {
  const scopes: MigrationScope[] = [];
  let migrated = false;
  let skippedExisting = false;

  const accountChannels = resolveAccountChannels(params.cfg, params.accountId).channels;
  if (accountChannels) {
    const result = migrateSlackChannelsInPlace(
      accountChannels,
      params.oldChannelId,
      params.newChannelId,
    );
    if (result.migrated) {
      migrated = true;
      scopes.push("account");
    }
    if (result.skippedExisting) {
      skippedExisting = true;
    }
  }

  const globalChannels = params.cfg.channels?.slack?.channels;
  if (globalChannels) {
    const result = migrateSlackChannelsInPlace(
      globalChannels,
      params.oldChannelId,
      params.newChannelId,
    );
    if (result.migrated) {
      migrated = true;
      scopes.push("global");
    }
    if (result.skippedExisting) {
      skippedExisting = true;
    }
  }

  return { migrated, skippedExisting, scopes };
}

/**
 * Persist a Slack channel id move.
 *
 * `loadConfig()` returns the live runtime snapshot. `writeConfigFile` diffs that
 * snapshot against the object it receives, so mutating the snapshot in place
 * produces an empty patch and the following refresh restores the old channel id.
 */
export async function persistSlackChannelMigration(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  oldChannelId: string;
  newChannelId: string;
}): Promise<SlackChannelMigrationResult> {
  const nextConfig = structuredClone(params.cfg);
  const migration = migrateSlackChannelConfig({
    cfg: nextConfig,
    accountId: params.accountId,
    oldChannelId: params.oldChannelId,
    newChannelId: params.newChannelId,
  });
  if (migration.migrated) {
    await writeConfigFile(nextConfig);
  }
  return migration;
}
