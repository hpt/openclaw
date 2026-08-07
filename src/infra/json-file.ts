import fs from "node:fs";
import path from "node:path";

export function loadJsonFile(pathname: string): unknown {
  try {
    if (!fs.existsSync(pathname)) {
      return undefined;
    }
    const raw = fs.readFileSync(pathname, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function saveJsonFile(pathname: string, data: unknown) {
  const dir = path.dirname(pathname);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  // Write via temp+rename so a crash mid-write cannot truncate the live file to
  // partial/invalid JSON (subagent registry, auth profiles, CLI credentials).
  const tmp = path.join(
    dir,
    `.${path.basename(pathname)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  fs.writeFileSync(tmp, payload, { encoding: "utf8", mode: 0o600 });
  try {
    fs.renameSync(tmp, pathname);
  } catch (err) {
    const code = (err as { code?: string }).code;
    // Windows may not atomically replace an existing destination via rename.
    if (code === "EPERM" || code === "EEXIST") {
      fs.copyFileSync(tmp, pathname);
      fs.unlinkSync(tmp);
    } else {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // best-effort
      }
      throw err;
    }
  }
  try {
    fs.chmodSync(pathname, 0o600);
  } catch {
    // best-effort on platforms that ignore mode bits
  }
}
