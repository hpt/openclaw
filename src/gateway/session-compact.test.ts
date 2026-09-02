import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compactSessionTranscriptFile, sliceTranscriptLinesForCompact } from "./session-compact.js";

describe("sliceTranscriptLinesForCompact", () => {
  it("returns the original lines when already within the cap", () => {
    const lines = ["a", "b", "c"];
    expect(sliceTranscriptLinesForCompact(lines, 3)).toEqual(lines);
    expect(sliceTranscriptLinesForCompact(lines, 10)).toEqual(lines);
  });

  it("keeps a suffix when there is no session header", () => {
    const lines = ["a", "b", "c", "d", "e"];
    expect(sliceTranscriptLinesForCompact(lines, 3)).toEqual(["c", "d", "e"]);
  });

  it("preserves the session header and fills the remaining budget from the tail", () => {
    const header = JSON.stringify({ type: "session", version: 1, id: "sess-1" });
    const lines = [header, "m1", "m2", "m3", "m4", "m5"];
    expect(sliceTranscriptLinesForCompact(lines, 3)).toEqual([header, "m4", "m5"]);
  });

  it("keeps only the session header when maxLines is 1", () => {
    const header = JSON.stringify({ type: "session", version: 1, id: "sess-1" });
    expect(sliceTranscriptLinesForCompact([header, "m1", "m2"], 1)).toEqual([header]);
  });
});

describe("compactSessionTranscriptFile", () => {
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  async function writeTranscript(lines: string[]): Promise<string> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-session-compact-"));
    const filePath = path.join(tmpDir, "sess.jsonl");
    await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf-8");
    return filePath;
  }

  it("is a no-op when the transcript is already within maxLines", async () => {
    const filePath = await writeTranscript(["a", "b"]);
    const result = await compactSessionTranscriptFile({ filePath, maxLines: 3 });
    expect(result).toEqual({ compacted: false, kept: 2 });
    expect(await fs.readFile(filePath, "utf-8")).toBe("a\nb\n");
  });

  it("archives the original file and rewrites a header-preserving suffix", async () => {
    const header = JSON.stringify({ type: "session", version: 1, id: "sess-1" });
    const filePath = await writeTranscript([header, "m1", "m2", "m3", "m4"]);
    const result = await compactSessionTranscriptFile({ filePath, maxLines: 3 });
    expect(result.compacted).toBe(true);
    expect(result.kept).toBe(3);
    expect(result.archived).toMatch(/\.bak\./);
    expect(await fs.readFile(filePath, "utf-8")).toBe(`${header}\nm3\nm4\n`);
    expect(await fs.readFile(result.archived ?? "", "utf-8")).toBe(`${header}\nm1\nm2\nm3\nm4\n`);
  });
});
