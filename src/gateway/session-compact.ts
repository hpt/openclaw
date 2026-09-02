import fs from "node:fs";
import { acquireSessionWriteLock } from "../agents/session-write-lock.js";
import { archiveFileOnDisk } from "./session-transcript-files.fs.js";

export function isSessionHeaderLine(line: string): boolean {
  try {
    const parsed = JSON.parse(line) as { type?: unknown };
    return Boolean(
      parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.type === "session",
    );
  } catch {
    return false;
  }
}

/**
 * Keep a suffix of JSONL transcript lines, always retaining the session header
 * when present so SessionManager can still open the file after a line-cap.
 */
export function sliceTranscriptLinesForCompact(lines: string[], maxLines: number): string[] {
  if (maxLines < 1 || lines.length <= maxLines) {
    return lines;
  }
  const header = isSessionHeaderLine(lines[0] ?? "") ? lines[0] : undefined;
  if (!header) {
    return lines.slice(-maxLines);
  }
  const body = lines.slice(1);
  const bodyBudget = Math.max(0, maxLines - 1);
  if (bodyBudget === 0) {
    return [header];
  }
  return [header, ...body.slice(-bodyBudget)];
}

export async function compactSessionTranscriptFile(params: {
  filePath: string;
  maxLines: number;
}): Promise<{ compacted: boolean; archived?: string; kept: number }> {
  const sessionLock = await acquireSessionWriteLock({ sessionFile: params.filePath });
  try {
    const raw = fs.readFileSync(params.filePath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length <= params.maxLines) {
      return { compacted: false, kept: lines.length };
    }
    const archived = archiveFileOnDisk(params.filePath, "bak");
    const keptLines = sliceTranscriptLinesForCompact(lines, params.maxLines);
    fs.writeFileSync(params.filePath, `${keptLines.join("\n")}\n`, "utf-8");
    return { compacted: true, archived, kept: keptLines.length };
  } finally {
    await sessionLock.release();
  }
}
