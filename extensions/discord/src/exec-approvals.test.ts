import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../../src/config/config.js";
import {
  isDiscordExecApprovalApprover,
  isDiscordExecApprovalClientEnabled,
} from "./exec-approvals.js";

function buildConfig(
  execApprovals?: NonNullable<NonNullable<OpenClawConfig["channels"]>["discord"]>["execApprovals"],
): OpenClawConfig {
  return {
    channels: {
      discord: {
        token: "tok",
        execApprovals,
      },
    },
  } as OpenClawConfig;
}

describe("discord exec approvals", () => {
  it("requires enablement and at least one approver", () => {
    expect(isDiscordExecApprovalClientEnabled({ cfg: buildConfig() })).toBe(false);
    expect(
      isDiscordExecApprovalClientEnabled({
        cfg: buildConfig({ enabled: true }),
      }),
    ).toBe(false);
    expect(
      isDiscordExecApprovalClientEnabled({
        cfg: buildConfig({ enabled: true, approvers: ["123"] }),
      }),
    ).toBe(true);
  });

  it("matches approvers by normalized sender id", () => {
    const cfg = buildConfig({ enabled: true, approvers: [123 as unknown as string, "456"] });
    expect(isDiscordExecApprovalApprover({ cfg, senderId: "123" })).toBe(true);
    expect(isDiscordExecApprovalApprover({ cfg, senderId: "456" })).toBe(true);
    expect(isDiscordExecApprovalApprover({ cfg, senderId: " 456 " })).toBe(true);
    expect(isDiscordExecApprovalApprover({ cfg, senderId: "789" })).toBe(false);
    expect(isDiscordExecApprovalApprover({ cfg, senderId: "" })).toBe(false);
  });
});
