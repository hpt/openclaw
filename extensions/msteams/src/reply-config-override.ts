import type { OpenClawConfig } from "../runtime-api.js";

/**
 * Teams client timezones are a per-turn hint. The patch must contain only
 * `userTimezone`: the channel monitor keeps the config object it started with,
 * and `agents` reloads do not restart that monitor. Spreading those defaults
 * into the reply merge would restore stale model, sandbox, and elevated
 * settings over the live config.
 */
export function buildMSTeamsSenderTimezoneConfigOverride(params: {
  cfg: OpenClawConfig;
  senderTimezone?: string;
}): OpenClawConfig | undefined {
  const senderTimezone = params.senderTimezone?.trim();
  if (!senderTimezone) {
    return undefined;
  }
  const configuredTimezone = params.cfg.agents?.defaults?.userTimezone?.trim();
  if (configuredTimezone) {
    return undefined;
  }
  return {
    agents: {
      defaults: {
        userTimezone: senderTimezone,
      },
    },
  };
}
