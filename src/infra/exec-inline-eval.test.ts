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

  it("detects versioned interpreters and clustered inline-eval forms", () => {
    const cases = [
      { argv: ["python3.12", "-c", "print(1)"], expected: "python3.12 -c" },
      { argv: ["/usr/bin/python3.12", "-Bc", "print(1)"], expected: "python3.12 -c" },
      { argv: ["python3.12", "-cprint(1)"], expected: "python3.12 -c" },
      { argv: ["python3.12m", "-OOc", "print(1)"], expected: "python3.12m -c" },
      { argv: ["pypy3.10", "-c", "print(1)"], expected: "pypy3.10 -c" },
      { argv: ["python3", "-Bc", "print(1)"], expected: "python3 -c" },
      { argv: ["python3", "-cprint(1)"], expected: "python3 -c" },
      { argv: ["perl5.38.2", "-e", "print 1"], expected: "perl5.38.2 -e" },
      { argv: ["perl5.38.2", "-E", "say 1"], expected: "perl5.38.2 -e" },
      { argv: ["perl5.38.2", "-ne", "print"], expected: "perl5.38.2 -e" },
      { argv: ["perl5.38.2", "-eprint 1"], expected: "perl5.38.2 -e" },
      { argv: ["perl5.38.2", "-0e", "print"], expected: "perl5.38.2 -e" },
      {
        argv: ["perl5.38-x86_64-linux-gnu", "-we", "print"],
        expected: "perl5.38-x86_64-linux-gnu -e",
      },
      { argv: ["perl", "-ne", "print"], expected: "perl -e" },
      { argv: ["perl", "-eprint 1"], expected: "perl -e" },
      { argv: ["node20", "-e", "console.log(1)"], expected: "node20 -e" },
      { argv: ["node20", "--eval=console.log(1)"], expected: "node20 --eval" },
      { argv: ["/usr/bin/node", "--eval=console.log(1)"], expected: "node --eval" },
      { argv: ["ruby3.2", "-e", "puts 1"], expected: "ruby3.2 -e" },
      { argv: ["php8.3", "-r", "echo 1;"], expected: "php8.3 -r" },
      { argv: ["php8.3-cgi", "-r", "echo 1;"], expected: "php8.3-cgi -r" },
      { argv: ["lua5.4", "-e", "print(1)"], expected: "lua5.4 -e" },
      { argv: ["luajit2.1", "-e", "print(1)"], expected: "luajit2.1 -e" },
    ];
    for (const testCase of cases) {
      const hit = detectInterpreterInlineEvalArgv(testCase.argv);
      expect(hit, testCase.argv.join(" ")).not.toBeNull();
      expect(describeInterpreterInlineEval(hit!), testCase.argv.join(" ")).toBe(testCase.expected);
    }
  });

  it("ignores normal script execution and non-interpreter names", () => {
    expect(detectInterpreterInlineEvalArgv(["python3", "script.py"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["python3.12", "script.py"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["python3.12", "-m", "http.server"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["python3.12", "-mhttp.server"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["python3.12", "-Xc", "script.py"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["python3.12-config", "-c", "print(1)"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["perl5.38.2", "script.pl"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["perl5.38.2", "-c", "script.pl"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["perl5.38.2", "-MEnglish", "script.pl"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["perl5.38.2", "-d:English", "script.pl"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["perl5.38.2", "-0x1ff", "script.pl"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["perlbug", "-e", "print 1"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["perldoc", "-e", "print 1"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["perl5.38-config", "-e", "print 1"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["node", "script.js"])).toBeNull();
    expect(detectInterpreterInlineEvalArgv(["node", "--print=1+1"])).toBeNull();
    expect(
      detectInterpreterInlineEvalArgv(["node20", "--experimental-vm-modules", "script.js"]),
    ).toBeNull();
    expect(
      detectInterpreterInlineEvalArgv([
        "python-argcomplete-check-easy-install-script",
        "-c",
        "print(1)",
      ]),
    ).toBeNull();
  });

  it("matches interpreter-like allowlist patterns", () => {
    expect(isInterpreterLikeAllowlistPattern("/usr/bin/python3")).toBe(true);
    expect(isInterpreterLikeAllowlistPattern("/usr/bin/python3.12")).toBe(true);
    expect(isInterpreterLikeAllowlistPattern("/usr/bin/perl5.38.2")).toBe(true);
    expect(isInterpreterLikeAllowlistPattern("/usr/bin/perl5.38-x86_64-linux-gnu")).toBe(true);
    expect(isInterpreterLikeAllowlistPattern("**/node")).toBe(true);
    expect(isInterpreterLikeAllowlistPattern("/usr/local/bin/node20")).toBe(true);
    expect(isInterpreterLikeAllowlistPattern("C:\\Tools\\Python3.12.EXE")).toBe(true);
    expect(isInterpreterLikeAllowlistPattern("/usr/bin/ruby3.2")).toBe(true);
    expect(isInterpreterLikeAllowlistPattern("/usr/bin/rg")).toBe(false);
    expect(isInterpreterLikeAllowlistPattern("/usr/bin/perlbug")).toBe(false);
    expect(isInterpreterLikeAllowlistPattern("/usr/bin/python3.12-config")).toBe(false);
  });
});
