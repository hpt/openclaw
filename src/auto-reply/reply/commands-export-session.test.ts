import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPORT_SESSION_PATH_ERROR,
  resolveExportSessionOutputPath,
} from "./commands-export-session.js";

const workspaceDir = path.join(os.tmpdir(), "openclaw-export-workspace");
const sessionId = "abcdef1234567890";
const now = new Date("2026-08-28T11:16:00.000Z");

describe("resolveExportSessionOutputPath", () => {
  it("defaults to a workspace HTML file", () => {
    const result = resolveExportSessionOutputPath({
      workspaceDir,
      sessionId,
      now,
    });
    expect(result).toEqual({
      relativePath: "openclaw-session-abcdef12-2026-08-28T11-16-00.html",
      absolutePath: path.join(workspaceDir, "openclaw-session-abcdef12-2026-08-28T11-16-00.html"),
    });
  });

  it("resolves relative paths inside the workspace", () => {
    const result = resolveExportSessionOutputPath({
      outputPath: "exports/chat.html",
      workspaceDir,
      sessionId,
    });
    expect(result).toEqual({
      relativePath: path.join("exports", "chat.html"),
      absolutePath: path.join(workspaceDir, "exports", "chat.html"),
    });
  });

  it("allows absolute paths that stay inside the workspace", () => {
    const outputPath = path.join(workspaceDir, "out.html");
    const result = resolveExportSessionOutputPath({
      outputPath,
      workspaceDir,
      sessionId,
    });
    expect(result).toEqual({
      relativePath: "out.html",
      absolutePath: outputPath,
    });
  });

  it("rejects host config and other paths outside the workspace", () => {
    const cases = [
      path.join(os.homedir(), ".openclaw", "openclaw.json"),
      path.join(os.homedir(), ".openclaw", "agents", "main", "sessions", "sessions.json"),
      "/etc/passwd",
      path.join(workspaceDir, "..", "secrets.json"),
      "~/openclaw.json",
    ];
    for (const outputPath of cases) {
      expect(
        resolveExportSessionOutputPath({
          outputPath,
          workspaceDir,
          sessionId,
        }),
        outputPath,
      ).toEqual({ error: EXPORT_SESSION_PATH_ERROR });
    }
  });
});
