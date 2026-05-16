import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerFiles } from "../src/routes/files.js";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cargas-"));
  writeFileSync(join(dir, "a.csv"), "x");
  writeFileSync(join(dir, "note.txt"), "y");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("GET /api/files", () => {
  it("lists only .csv files with size", async () => {
    const app = Fastify();
    registerFiles(app, { CARGAS_DIR: dir } as never);
    const res = await app.inject({ method: "GET", url: "/api/files" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { name: string; size: number }[];
    expect(body.map((f) => f.name)).toEqual(["a.csv"]);
    expect(body[0].size).toBeGreaterThan(0);
    await app.close();
  });
});
