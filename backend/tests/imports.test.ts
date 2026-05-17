import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerImportsExists } from "../src/routes/imports.js";

function repo(stats: { rows: number; lastIngestedAt: string }) {
  return {
    deleteByFileName: async () => {},
    insertRows: async () => {},
    fileStats: async () => stats,
  };
}

describe("GET /api/imports/exists", () => {
  it("returns exists=true with rows and lastIngestedAt", async () => {
    const app = Fastify();
    registerImportsExists(app, { repo: repo({ rows: 686181, lastIngestedAt: "2026-05-16 23:42:32" }) as never });
    const res = await app.inject({ method: "GET", url: "/api/imports/exists?file=Consultaderequestsresultados635.csv" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ exists: true, rows: 686181, lastIngestedAt: "2026-05-16 23:42:32" });
    await app.close();
  });

  it("returns exists=false when rows=0", async () => {
    const app = Fastify();
    registerImportsExists(app, { repo: repo({ rows: 0, lastIngestedAt: "" }) as never });
    const res = await app.inject({ method: "GET", url: "/api/imports/exists?file=novo.csv" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ exists: false, rows: 0, lastIngestedAt: "" });
    await app.close();
  });

  it("400 when file is missing", async () => {
    const app = Fastify();
    registerImportsExists(app, { repo: repo({ rows: 0, lastIngestedAt: "" }) as never });
    const res = await app.inject({ method: "GET", url: "/api/imports/exists" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
