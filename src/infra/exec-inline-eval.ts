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
  // is recognized without treating every `--eval…` long option as inline code.
  prefixFlags?: readonly string[];
  // Short options can be clustered (`python -Bc`, `perl -ne`) or carry the
  // program text in the same argv token (`python -cprint(1)`, `perl -eprint`).
  // Exact flag equality misses both, which lets allowlisted interpreters skip
  // strictInlineEval approval.
  clusteredEval?: (token: string) => boolean;
  clusteredFlag?: string;
};

const PYTHON_CLUSTER_ARGUMENT_LETTERS = new Set(["m", "Q", "W", "X"]);
const PERL_CLUSTER_ARGUMENT_LETTERS = new Set(["C", "D", "F", "i", "I", "m", "M", "x"]);

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
  },
  {
    names: ["node", "nodejs", "bun", "deno"],
    exactFlags: new Set(["-e", "--eval", "-p", "--print"]),
    prefixFlags: ["--eval="],
  },
  { names: ["ruby"], exactFlags: new Set(["-e"]) },
  {
    names: ["perl"],
    exactFlags: new Set(["-e", "-E"]),
    clusteredEval: perlClusterHidesEvalFlag,
    clusteredFlag: "-e",
  },
  { names: ["php"], exactFlags: new Set(["-r"]) },
  { names: ["lua"], exactFlags: new Set(["-e"]) },
  { names: ["osascript"], exactFlags: new Set(["-e"]) },
];

const INTERPRETER_INLINE_EVAL_NAMES = new Set(
  INTERPRETER_INLINE_EVAL_SPECS.flatMap((entry) => entry.names),
);

function findInterpreterSpec(executable: string): InterpreterFlagSpec | null {
  const normalized = normalizeExecutableToken(executable);
  for (const spec of INTERPRETER_INLINE_EVAL_SPECS) {
    if (spec.names.includes(normalized)) {
      return spec;
    }
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
      return {
        executable,
        normalizedExecutable: normalizeExecutableToken(executable),
        flag: lower,
        argv,
      };
    }
    const matchedPrefix = spec.prefixFlags?.find((prefix) => lower.startsWith(prefix));
    if (matchedPrefix) {
      const flag = matchedPrefix.endsWith("=") ? matchedPrefix.slice(0, -1) : matchedPrefix;
      return {
        executable,
        normalizedExecutable: normalizeExecutableToken(executable),
        flag,
        argv,
      };
    }
    if (spec.clusteredEval?.(token)) {
      return {
        executable,
        normalizedExecutable: normalizeExecutableToken(executable),
        flag: spec.clusteredFlag ?? lower,
        argv,
      };
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
  const normalized = normalizeExecutableToken(trimmed);
  if (INTERPRETER_INLINE_EVAL_NAMES.has(normalized)) {
    return true;
  }
  const basename = trimmed.replace(/\\/g, "/").split("/").pop() ?? trimmed;
  const withoutExe = basename.endsWith(".exe") ? basename.slice(0, -4) : basename;
  const strippedWildcards = withoutExe.replace(/[*?[\]{}()]/g, "");
  return INTERPRETER_INLINE_EVAL_NAMES.has(strippedWildcards);
}
