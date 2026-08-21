import { vi } from "vitest";
import type { MockFn } from "../test-utils/vitest-mock-fn.js";

export const configMocks: {
  readConfigFileSnapshot: MockFn;
  readConfigFileSnapshotForWrite: MockFn;
  writeConfigFile: MockFn;
} = {
  readConfigFileSnapshot: vi.fn() as unknown as MockFn,
  readConfigFileSnapshotForWrite: vi.fn(async () => ({
    snapshot: await configMocks.readConfigFileSnapshot(),
    writeOptions: {},
  })) as unknown as MockFn,
  writeConfigFile: vi.fn().mockResolvedValue(undefined) as unknown as MockFn,
};

export const offsetMocks: {
  deleteTelegramUpdateOffset: MockFn;
} = {
  deleteTelegramUpdateOffset: vi.fn().mockResolvedValue(undefined) as unknown as MockFn,
};

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    readConfigFileSnapshot: configMocks.readConfigFileSnapshot,
    readConfigFileSnapshotForWrite: configMocks.readConfigFileSnapshotForWrite,
    writeConfigFile: configMocks.writeConfigFile,
  };
});

vi.mock("../../extensions/telegram/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../extensions/telegram/api.js")>();
  return {
    ...actual,
    deleteTelegramUpdateOffset: offsetMocks.deleteTelegramUpdateOffset,
  };
});

vi.mock("../../extensions/telegram/src/update-offset-store.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../extensions/telegram/src/update-offset-store.js")>();
  return {
    ...actual,
    deleteTelegramUpdateOffset: offsetMocks.deleteTelegramUpdateOffset,
  };
});
