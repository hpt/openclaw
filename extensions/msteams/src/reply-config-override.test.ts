import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../runtime-api.js";
import { buildMSTeamsSenderTimezoneConfigOverride } from "./reply-config-override.js";

describe("buildMSTeamsSenderTimezoneConfigOverride", () => {
  it("patches only the sender timezone when the live config has none", () => {
    const live = {
      agents: {
        defaults: {
          model: { primary: "openai/gpt-5.4" },
          elevatedDefault: "off",
          sandbox: { mode: "all" },
        },
      },
    } as OpenClawConfig;

    expect(
      buildMSTeamsSenderTimezoneConfigOverride({
        cfg: live,
        senderTimezone: " America/New_York ",
      }),
    ).toEqual({
      agents: {
        defaults: {
          userTimezone: "America/New_York",
        },
      },
    });
  });

  it("does not override an explicit live userTimezone", () => {
    const live = {
      agents: {
        defaults: {
          userTimezone: "UTC",
          model: { primary: "openai/gpt-5.4" },
        },
      },
    } as OpenClawConfig;

    expect(
      buildMSTeamsSenderTimezoneConfigOverride({
        cfg: live,
        senderTimezone: "America/Los_Angeles",
      }),
    ).toBeUndefined();
  });

  it("skips the patch when the sender has no timezone", () => {
    expect(
      buildMSTeamsSenderTimezoneConfigOverride({
        cfg: { agents: { defaults: { elevatedDefault: "off" } } } as OpenClawConfig,
        senderTimezone: "   ",
      }),
    ).toBeUndefined();
  });
});
