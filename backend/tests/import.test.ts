import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import { registerImport } from "../src/routes/import.js";
import { JobStore } from "../src/ingest/jobStore.js";

const here = dirname(fileURLToPath(import.meta.url));

function fakeRepo(stats = { rows: 0, lastIngestedAt: "" }) {
  const inserted: unknown[] = [];
  const deletedFiles: string[] = [];
  return {
    inserted,
    deletedFiles,
    deleteByFileName: async (f: string) => { deletedFiles.push(f); },
    insertRows: async (r: unknown[]) => { inserted.push(...r); },
    fileStats: async () => stats,
  };
}

describe("import route", () => {
  it("starts a job and reports progress until done", async () => {
    const app = Fastify();
    const jobs = new JobStore();
    const repo = fakeRepo();
    registerImport(app, {
      cfg: { CARGAS_DIR: join(here, "fixtures"), INGEST_BATCH_SIZE: 2 } as never,
      repo: repo as never,
      jobs,
    });

    const start = await app.inject({
      method: "POST",
      url: "/api/import",
      payload: { file: "sample.csv" },
    });
    expect(start.statusCode).toBe(202);
    const { jobId } = start.json() as { jobId: string };
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);

    let job: { status: string; rowsInserted: number } | undefined;
    for (let i = 0; i < 50; i++) {
      const r = await app.inject({ method: "GET", url: `/api/import/${jobId}` });
      job = r.json() as never;
      if (job!.status !== "running") break;
      await new Promise((res) => setTimeout(res, 20));
    }
    expect(job!.status).toBe("done");
    expect(job!.rowsInserted).toBe(3);
    expect(repo.inserted.length).toBe(3);
    await app.close();
  });

  it("rejects unknown or non-csv files with 400", async () => {
    const app = Fastify();
    registerImport(app, {
      cfg: { CARGAS_DIR: join(here, "fixtures"), INGEST_BATCH_SIZE: 2 } as never,
      repo: fakeRepo() as never,
      jobs: new JobStore(),
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/import",
      payload: { file: "../secrets.txt" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("409 already_imported when file exists and no replace", async () => {
    const app = Fastify();
    registerImport(app, {
      cfg: { CARGAS_DIR: join(here, "fixtures"), INGEST_BATCH_SIZE: 2 } as never,
      repo: fakeRepo({ rows: 686181, lastIngestedAt: "2026-05-16 23:42:32" }) as never,
      jobs: new JobStore(),
    });
    const res = await app.inject({
      method: "POST", url: "/api/import",
      payload: { file: "sample.csv" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "already_imported", rows: 686181 });
    await app.close();
  });

  it("replaces (202) when file exists and replace=true", async () => {
    const app = Fastify();
    const repo = fakeRepo({ rows: 5, lastIngestedAt: "2026-05-16 00:00:00" });
    registerImport(app, {
      cfg: { CARGAS_DIR: join(here, "fixtures"), INGEST_BATCH_SIZE: 2 } as never,
      repo: repo as never,
      jobs: new JobStore(),
    });
    const res = await app.inject({
      method: "POST", url: "/api/import",
      payload: { file: "sample.csv", replace: true },
    });
    expect(res.statusCode).toBe(202);
    const { jobId } = res.json() as { jobId: string };
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    for (let i = 0; i < 50; i++) { if (repo.inserted.length >= 1) break; await new Promise((x) => setTimeout(x, 20)); }
    expect(repo.inserted.length).toBeGreaterThan(0);
    expect(repo.deletedFiles).toContain("sample.csv");
    await app.close();
  });

  it("400 not_found when file absent even with replace=true", async () => {
    const app = Fastify();
    registerImport(app, {
      cfg: { CARGAS_DIR: join(here, "fixtures"), INGEST_BATCH_SIZE: 2 } as never,
      repo: fakeRepo({ rows: 5, lastIngestedAt: "2026-05-16 00:00:00" }) as never,
      jobs: new JobStore(),
    });
    const res = await app.inject({ method: "POST", url: "/api/import", payload: { file: "ghost.csv", replace: true } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
