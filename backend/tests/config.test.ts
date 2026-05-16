import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  CLICKHOUSE_URL: "http://localhost:8123",
  CLICKHOUSE_USER: "u",
  CLICKHOUSE_PASSWORD: "",
};

describe("loadConfig — upload settings", () => {
  it("defaults UPLOAD_DIR=/uploads and MAX_UPLOAD_BYTES=0", () => {
    const c = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(c.UPLOAD_DIR).toBe("/uploads");
    expect(c.MAX_UPLOAD_BYTES).toBe(0);
  });

  it("reads overrides and coerces MAX_UPLOAD_BYTES to number", () => {
    const c = loadConfig({ ...base, UPLOAD_DIR: "/tmp/up", MAX_UPLOAD_BYTES: "1048576" } as NodeJS.ProcessEnv);
    expect(c.UPLOAD_DIR).toBe("/tmp/up");
    expect(c.MAX_UPLOAD_BYTES).toBe(1048576);
  });

  it("rejects negative MAX_UPLOAD_BYTES", () => {
    expect(() => loadConfig({ ...base, MAX_UPLOAD_BYTES: "-1" } as NodeJS.ProcessEnv)).toThrow();
  });
});
