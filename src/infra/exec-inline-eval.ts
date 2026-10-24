import { normalizeExecutableToken } from "./exec-wrapper-resolution.js";

export type InterpreterInlineEvalHit = {
  executable: string;
  normalizedExecutable: string;
  flag: string;
  argv: string[];
};

type InterpreterFlagSpec = {
  names: readonly string[];
  exactFlags: ReadonlySet<string>;
  // Matched against the lowercased token. Use a trailing "=" so `--eval=code`
  // is recognized without treating every `--eval...` long option as inline code.
  prefixFlags?: readonly string[];
  // Short options can be clustered (`python3.12 -Bc`, `perl5.38.2 -ne`) or
  // carry the program text in the same argv token (`python3.12 -cCODE`).
  clusteredEval?: (token: string) => boolean;
  clusteredFlag?: string;
  // Remainder after a base name. Exact names are matched separately.
  versionSuffix?: RegExp;
  // When set, only these base names accept versionSuffix. Other names in the
  // spec stay exact so `bun` does not also match `bun1`.
  versionedNames?: readonly string[];
};

const PYTHON_CLUSTER_ARGUMENT_LETTERS = new Set(["m", "Q", "W", "X"]);
const PERL_CLUSTER_ARGUMENT_LETTERS = new Set(["C", "D", "F", "i", "I", "m", "M", "x"]);
const DOTTED_VERSION_SUFFIX = /^\d+(?:\.\d+)*$/;
// `python3.12`, `python3.12m`, and `pypy3.10`. The dotted form avoids matching
// unrelated names such as `python3.12-config`.
const PYTHON_VERSION_SUFFIX = /^(?:\d+(?:\.\d+)+|\.\d+(?:\.\d+)*)[tdmu]?$/;
// `perl5.38.2` and Debian multiarch `perl5.38-x86_64-linux-gnu`. A single
// hyphen suffix (`perl5.38-config`) is not an interpreter.
const PERL_VERSION_SUFFIX = /^\d+(?:\.\d+)*(?:(?:-[a-z0-9_]+){2,4})?$/;
const PHP_VERSION_SUFFIX = /^\d+(?:\.\d+)*(?:-cgi)?$/;

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function pythonClusterHidesCommandFlag(token: string): boolean {
  if (!token.startsWith("-") || token.startsWith("--") || token === "-") {
    return false;
  }
  const body = token.slice(1);
  for (let index = 0; index < body.length; index += 1) {
    const letter = body[index];
    if (letter === "c") {
      return true;
    }
    // -m/-Q/-W/-X consume the remainder of the cluster as their value.
    if (letter !== undefined && PYTHON_CLUSTER_ARGUMENT_LETTERS.has(letter)) {
      return false;
    }
  }
  return false;
}

function perlClusterHidesEvalFlag(token: string): boolean {
  if (!token.startsWith("-") || token.startsWith("--") || token === "-") {
    return false;
  }
  const body = token.slice(1);
  let index = 0;
  while (index < body.length) {
    const letter = body[index];
    if (letter === "e" || letter === "E") {
      return true;
    }
    if (letter === "0") {
      index += 1;
      // -0xHH consumes the rest of the switch; octal -012 does not.
      if (body[index] === "x" || body[index] === "X") {
        return false;
      }
      while (isDigit(body[index])) {
        index += 1;
      }
      continue;
    }
    if (letter === "l") {
      index += 1;
      while (isDigit(body[index])) {
        index += 1;
      }
      continue;
    }
    // -d:Module names a debugger library. -de is still debug plus eval.
    if (letter === "d") {
      index += 1;
      if (body[index] === ":") {
        return false;
      }
      continue;
    }
    if (letter !== undefined && PERL_CLUSTER_ARGUMENT_LETTERS.has(letter)) {
      return false;
    }
    index += 1;
  }
  return false;
}

const INTERPRETER_INLINE_EVAL_SPECS: readonly InterpreterFlagSpec[] = [
  {
    names: ["python", "python2", "python3", "pypy", "pypy3"],
    exactFlags: new Set(["-c"]),
    clusteredEval: pythonClusterHidesCommandFlag,
    clusteredFlag: "-c",
    versionSuffix: PYTHON_VERSION_SUFFIX,
  },
  {
    names: ["node", "nodejs", "bun", "deno"],
    exactFlags: new Set(["-e", "--eval", "-p", "--print"]),
    prefixFlags: ["--eval="],
    versionSuffix: DOTTED_VERSION_SUFFIX,
    versionedNames: ["node", "nodejs"],
  },
  {
    names: ["ruby"],
    exactFlags: new Set(["-e"]),
    versionSuffix: DOTTED_VERSION_SUFFIX,
  },
  {
    names: ["perl"],
    exactFlags: new Set(["-e", "-E"]),
    clusteredEval: perlClusterHidesEvalFlag,
    clusteredFlag: "-e",
    versionSuffix: PERL_VERSION_SUFFIX,
  },
  {
    names: ["php"],
    exactFlags: new Set(["-r"]),
    versionSuffix: PHP_VERSION_SUFFIX,
  },
  {
    names: ["lua", "luajit"],
    exactFlags: new Set(["-e"]),
    versionSuffix: DOTTED_VERSION_SUFFIX,
  },
  { names: ["osascript"], exactFlags: new Set(["-e"]) },
];

function matchesInterpreterName(normalized: string, spec: InterpreterFlagSpec): boolean {
  const names = [...spec.names].toSorted((left, right) => right.length - left.length);
  for (const name of names) {
    if (normalized === name) {
      return true;
    }
    if (!spec.versionSuffix) {
      continue;
    }
    if (spec.versionedNames && !spec.versionedNames.includes(name)) {
      continue;
    }
    if (!normalized.startsWith(name) || normalized.length === name.length) {
      continue;
    }
    if (spec.versionSuffix.test(normalized.slice(name.length))) {
      return true;
    }
  }
  return false;
}

function findInterpreterSpec(executable: string): InterpreterFlagSpec | null {
  const normalized = normalizeExecutableToken(executable);
  for (const spec of INTERPRETER_INLINE_EVAL_SPECS) {
    if (matchesInterpreterName(normalized, spec)) {
      return spec;
    }
  }
  return null;
}

function inlineEvalHit(executable: string, flag: string, argv: string[]): InterpreterInlineEvalHit {
  return {
    executable,
    normalizedExecutable: normalizeExecutableToken(executable),
    flag,
    argv,
  };
}

function matchedPrefixFlag(token: string, spec: InterpreterFlagSpec): string | null {
  const lower = token.toLowerCase();
  for (const prefix of spec.prefixFlags ?? []) {
    if (!lower.startsWith(prefix)) {
      continue;
    }
    return prefix.endsWith("=") ? prefix.slice(0, -1) : prefix;
  }
  return null;
}

export function detectInterpreterInlineEvalArgv(
  argv: string[] | undefined | null,
): InterpreterInlineEvalHit | null {
  if (!Array.isArray(argv) || argv.length === 0) {
    return null;
  }
  const executable = argv[0]?.trim();
  if (!executable) {
    return null;
  }
  const spec = findInterpreterSpec(executable);
  if (!spec) {
    return null;
  }
  for (let idx = 1; idx < argv.length; idx += 1) {
    const token = argv[idx]?.trim();
    if (!token) {
      continue;
    }
    if (token === "--") {
      break;
    }
    const lower = token.toLowerCase();
    if (spec.exactFlags.has(lower)) {
      return inlineEvalHit(executable, lower, argv);
    }
    const prefixFlag = matchedPrefixFlag(token, spec);
    if (prefixFlag) {
      return inlineEvalHit(executable, prefixFlag, argv);
    }
    if (spec.clusteredEval?.(token)) {
      return inlineEvalHit(executable, spec.clusteredFlag ?? lower, argv);
    }
  }
  return null;
}

export function describeInterpreterInlineEval(hit: InterpreterInlineEvalHit): string {
  return `${hit.normalizedExecutable} ${hit.flag}`;
}

export function isInterpreterLikeAllowlistPattern(pattern: string | undefined | null): boolean {
  const trimmed = pattern?.trim().toLowerCase() ?? "";
  if (!trimmed) {
    return false;
  }
  if (findInterpreterSpec(trimmed)) {
    return true;
  }
  const basename = trimmed.replace(/\\/g, "/").split("/").pop() ?? trimmed;
  const withoutExe = basename.endsWith(".exe") ? basename.slice(0, -4) : basename;
  const strippedWildcards = withoutExe.replace(/[*?[\]{}()]/g, "");
  if (strippedWildcards === withoutExe) {
    return false;
  }
  return findInterpreterSpec(strippedWildcards) !== null;
}
