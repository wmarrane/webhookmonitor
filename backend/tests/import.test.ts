import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import { registerImport } from "../src/routes/import.js";
import { JobStore } from "../src/ingest/jobStore.js";

const here = dirname(fileURLToPath(import.meta.url));

function fakeRepo() {
  const inserted: unknown[] = [];
  return {
    inserted,
    deleteByFileName: async () => {},
    insertRows: async (rows: unknown[]) => {
      inserted.push(...rows);
    },
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
});
