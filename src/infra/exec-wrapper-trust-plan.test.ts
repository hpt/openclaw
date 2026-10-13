import { describe, expect, test } from "vitest";
import { resolveExecWrapperTrustPlan } from "./exec-wrapper-trust-plan.js";

describe("resolveExecWrapperTrustPlan", () => {
  test("unwraps dispatch wrappers and shell multiplexers into one trust plan", () => {
    if (process.platform === "win32") {
      return;
    }
    expect(
      resolveExecWrapperTrustPlan(["/usr/bin/time", "-p", "busybox", "sh", "-lc", "echo hi"]),
    ).toEqual({
      argv: ["sh", "-lc", "echo hi"],
      policyArgv: ["busybox", "sh", "-lc", "echo hi"],
      wrapperChain: ["time", "busybox"],
      policyBlocked: false,
      shellWrapperExecutable: true,
      shellInlineCommand: "echo hi",
    });
  });

  test("fails closed for ssh-agent and gpg-agent carriers", () => {
    for (const argv of [
      ["/usr/bin/ssh-agent", "/bin/echo", "warmup-ok"],
      ["/usr/bin/ssh-agent", "-t", "1", "/bin/sh", "-c", "id"],
      ["/usr/bin/gpg-agent", "--daemon", "/bin/sh", "-c", "id"],
      ["/usr/bin/nice", "/usr/bin/ssh-agent", "/bin/sh", "-c", "id"],
    ]) {
      const plan = resolveExecWrapperTrustPlan(argv);
      expect(plan.policyBlocked).toBe(true);
      expect(plan.shellInlineCommand).toBeNull();
    }
  });

  test("unwraps rbash inline commands like other posix shells", () => {
    expect(resolveExecWrapperTrustPlan(["rbash", "-c", "echo hi"])).toEqual({
      argv: ["rbash", "-c", "echo hi"],
      policyArgv: ["rbash", "-c", "echo hi"],
      wrapperChain: [],
      policyBlocked: false,
      shellWrapperExecutable: true,
      shellInlineCommand: "echo hi",
    });
  });

  test("fails closed for unsupported shell multiplexer applets", () => {
    expect(resolveExecWrapperTrustPlan(["busybox", "sed", "-n", "1p"])).toEqual({
      argv: ["busybox", "sed", "-n", "1p"],
      policyArgv: ["busybox", "sed", "-n", "1p"],
      wrapperChain: [],
      policyBlocked: true,
      blockedWrapper: "busybox",
      shellWrapperExecutable: false,
      shellInlineCommand: null,
    });
  });

  test("fails closed when outer-wrapper depth overflows", () => {
    expect(
      resolveExecWrapperTrustPlan(["nohup", "timeout", "5s", "busybox", "sh", "-lc", "echo hi"], 2),
    ).toEqual({
      argv: ["busybox", "sh", "-lc", "echo hi"],
      policyArgv: ["busybox", "sh", "-lc", "echo hi"],
      wrapperChain: ["nohup", "timeout"],
      policyBlocked: true,
      blockedWrapper: "busybox",
      shellWrapperExecutable: false,
      shellInlineCommand: null,
    });
  });

  test("keeps the blocked dispatch argv as the policy target after transparent unwraps", () => {
    if (process.platform === "win32") {
      return;
    }
    expect(
      resolveExecWrapperTrustPlan([
        "/usr/bin/time",
        "-p",
        "/usr/bin/env",
        "FOO=bar",
        "sh",
        "-lc",
        "echo hi",
      ]),
    ).toEqual({
      argv: ["/usr/bin/env", "FOO=bar", "sh", "-lc", "echo hi"],
      policyArgv: ["/usr/bin/env", "FOO=bar", "sh", "-lc", "echo hi"],
      wrapperChain: [],
      policyBlocked: true,
      blockedWrapper: "env",
      shellWrapperExecutable: false,
      shellInlineCommand: null,
    });
  });
});
