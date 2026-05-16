import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server.js";

describe("GET /api/health", () => {
  it("returns ok with clickhouse status", async () => {
    const app = buildServer({
      cfg: {
        CLICKHOUSE_URL: "http://localhost:8123",
        CLICKHOUSE_USER: "x",
        CLICKHOUSE_PASSWORD: "",
        CLICKHOUSE_DB: "monitor",
        API_PORT: 8091,
        CARGAS_DIR: "/cargas",
        INGEST_BATCH_SIZE: 100,
        LOG_LEVEL: "silent",
      },
      pingClickHouse: async () => true,
    });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", clickhouse: true });
    await app.close();
  });
});
