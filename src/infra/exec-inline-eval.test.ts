import { describe, expect, it } from "vitest";
import {
  describeInterpreterInlineEval,
  detectInterpreterInlineEvalArgv,
  isInterpreterLikeAllowlistPattern,
} from "./exec-inline-eval.js";

describe("exec inline eval detection", () => {
  it("detects common interpreter eval flags", () => {
    const cases = [
      { argv: ["python3", "-c", "print('hi')"], expected: "python3 -c" },
      { argv: ["/usr/bin/node", "--eval", "console.log('hi')"], expected: "node --eval" },
      { argv: ["perl", "-E", "say 1"], expected: "perl -e" },
      { argv: ["osascript", "-e", "beep"], expected: "osascript -e" },
    ];
    for (const testCase of cases) {
      const hit = detectInterpreterInlineEvalArgv(testCase.argv);
      expect(hit).not.toBeNull();
      expect(describeInterpreterInlineEval(hit!)).toBe(testCase.expected);
    }
  });

  it("detects clustered and attached inline-eval forms", () => {
    const cases = [
      { argv: ["python3", "-Bc", "print(1)"], expected: "python3 -c" },
      { argv: ["python3", "-ic", "print(1)"], expected: "python3 -c" },
      { argv: ["python3", "-OOc", "print(1)"], expected: "python3 -c" },
      { argv: ["python3", "-cprint(1)"], expected: "python3 -c" },
      { argv: ["python3", "-bcprint(1)"], expected: "python3 -c" },
      { argv: ["perl", "-ne", "print"], expected: "perl -e" },
      { argv: ["perl", "-we", "print"], expected: "perl -e" },
      { argv: ["perl", "-ane", "print"], expected: "perl -e" },
      { argv: ["perl", "-0e", "print"], expected: "perl -e" },
      { argv: ["perl", "-le", "print"], expected: "perl -e" },
      { argv: ["perl", "-012e", "print"], expected: "perl -e" },
      { argv: ["perl", "-eprint 1"], expected: "perl -e" },
      { argv: ["perl", "-Eprint 1"], expected: "perl -e" },
      { argv: ["perl", "-weprint 1"], expected: "perl -e" },
      { argv: ["perl", "-0eprint 1"], expected: "perl -e" },
      { argv: ["/usr/bin/node", "--eval=console.log(1)"], expected: "node --eval" },
      { argv: ["node", "--Eval=console.log(1)"], expected: "node --eval" },
    ];
    for (const testCase of cases) {
      const hit = detectInterpreterInlineEvalArgv(testCase.argv);
      expect(hit, testCase.argv.join(" ")).not.toBeNull();
      expect(describeInterpreterInlineEval(hit!), testCase.argv.join(" ")).toBe(testCase.expected);
    }
  });

  it("ignores normal script execution", () => {
    expect(detectInterpreterInlineEvalArgv(["python3", "script.py"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["node", "script.js"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["python3", "-Wignore", "script.py"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["python3", "-mhttp.server"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["python3", "-m", "http.server"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["python3", "-Xc", "script.py"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["perl", "script.pl"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["perl", "-c", "script.pl"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["perl", "-MEnglish", "script.pl"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["perl", "-d:English", "script.pl"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["perl", "-0x1ff", "script.pl"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["perl", "-I/tmp", "script.pl"])).toBeNull();
    expect(
      detectInterpreterInlineEvalArgv(["node", "--experimental-vm-modules", "script.js"]),
    ).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["node", "--print=1+1"])).toBeNull();
  });

  it("matches interpreter-like allowlist patterns", () => {
    expect(isInterpreterLikeAllowlistPattern("/usr/bin/python3")).toBe(true);
    expect(isInterpreterLikeAllowlistPattern("**/node")).toBe(true);
    expect(isInterpreterLikeAllowlistPattern("/usr/bin/rg")).toBe(false);
  });
});
