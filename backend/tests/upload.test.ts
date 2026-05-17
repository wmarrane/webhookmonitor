import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import FormData from "form-data";
import { registerUpload } from "../src/routes/upload.js";
import { JobStore } from "../src/ingest/jobStore.js";

// Note: client-abort mid-upload is handled in upload.ts (pipeline rejects →
// unlink(dest) removes the partial file) but is not exercised here because
// app.inject() has no real socket to abort. Covered by code inspection.

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "uploads-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function fakeRepo(stats = { rows: 0, lastIngestedAt: "" }) {
  const inserted: unknown[] = [];
  return {
    inserted,
    deleteByFileName: async () => {},
    insertRows: async (r: unknown[]) => { inserted.push(...r); },
    fileStats: async () => stats,
  };
}

const CSV =
  "ID interno,Data,Hora,Nome,Título,Tipo,Tipo de script,Detalhes\n" +
  '3262308,15/05/2026,1:06,[CCC] MSG,nr,Depurar,Evento de usuário,"{""id"":""360738"",""type"":""invoice"",""fields"":{""custbody_nst_integra_id_"":""38967664""}}"\n';

async function build(maxBytes = 0, stats = { rows: 0, lastIngestedAt: "" }) {
  const app = Fastify();
  await app.register(multipart);
  const jobs = new JobStore();
  const repo = fakeRepo(stats);
  registerUpload(app, {
    cfg: { UPLOAD_DIR: dir, INGEST_BATCH_SIZE: 100, MAX_UPLOAD_BYTES: maxBytes } as never,
    repo: repo as never,
    jobs,
  });
  return { app, jobs, repo };
}

function form(filename: string, content: string) {
  const f = new FormData();
  f.append("file", Buffer.from(content), { filename, contentType: "text/csv" });
  return f;
}

describe("POST /api/upload", () => {
  it("streams a CSV to UPLOAD_DIR and ingests it (job done)", async () => {
    const { app, jobs, repo } = await build();
    const f = form("dados.csv", CSV);
    const res = await app.inject({ method: "POST", url: "/api/upload", payload: f, headers: f.getHeaders() });
    expect(res.statusCode).toBe(202);
    const { jobId } = res.json() as { jobId: string };
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);

    let st = "";
    for (let i = 0; i < 50; i++) {
      const r = await app.inject({ method: "GET", url: `/api/import/${jobId}` });
      st = (r.json() as { status: string }).status;
      if (st !== "running") break;
      await new Promise((x) => setTimeout(x, 20));
    }
    const job = jobs.get(jobId)!;
    expect(["done", "failed"]).toContain(job.status);
    expect(job.status).toBe("done");
    expect(repo.inserted.length).toBe(1);
    expect(readdirSync(dir).length).toBe(1);
    expect((repo.inserted[0] as { source_file: string }).source_file).toBe("dados.csv");
    await app.close();
  });

  it("rejects non-csv with 400", async () => {
    const { app } = await build();
    const f = form("nota.txt", "x");
    const res = await app.inject({ method: "POST", url: "/api/upload", payload: f, headers: f.getHeaders() });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("rejects when no file part is present", async () => {
    const { app } = await build();
    const f = new FormData();
    f.append("notafile", "x");
    const res = await app.inject({ method: "POST", url: "/api/upload", payload: f, headers: f.getHeaders() });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("enforces MAX_UPLOAD_BYTES and removes the partial file (413)", async () => {
    const { app } = await build(8);
    const f = form("grande.csv", CSV);
    const res = await app.inject({ method: "POST", url: "/api/upload", payload: f, headers: f.getHeaders() });
    expect(res.statusCode).toBe(413);
    expect(readdirSync(dir).length).toBe(0);
    await app.close();
  });

  it("MAX_UPLOAD_BYTES=0 accepts a file larger than 1MB (no implicit cap)", async () => {
    const { app, jobs } = await build(0);
    const row =
      '3262308,15/05/2026,1:06,[CCC] MSG,nr,Depurar,Evento de usuário,"{""id"":""360738""}"\n';
    // ~1.5 MB: well above @fastify/multipart's 1MB default fileSize fallback
    const big =
      "ID interno,Data,Hora,Nome,Título,Tipo,Tipo de script,Detalhes\n" +
      row.repeat(20000);
    expect(Buffer.byteLength(big)).toBeGreaterThan(1024 * 1024);
    const f = form("grande.csv", big);
    const res = await app.inject({ method: "POST", url: "/api/upload", payload: f, headers: f.getHeaders() });
    expect(res.statusCode).toBe(202);
    const { jobId } = res.json() as { jobId: string };
    for (let i = 0; i < 100; i++) {
      const j = jobs.get(jobId)!;
      if (j.status !== "running") break;
      await new Promise((x) => setTimeout(x, 20));
    }
    expect(jobs.get(jobId)!.status).toBe("done");
    expect(readdirSync(dir).length).toBe(1);
    await app.close();
  });

  it("sanitizes path-traversal filenames (stays inside UPLOAD_DIR)", async () => {
    const { app } = await build();
    const f = form("../../evil.csv", CSV);
    const res = await app.inject({ method: "POST", url: "/api/upload", payload: f, headers: f.getHeaders() });
    expect(res.statusCode).toBe(202);
    const names = readdirSync(dir);
    expect(names.length).toBe(1);
    expect(names[0].includes("..")).toBe(false);
    expect(names[0].endsWith(".csv")).toBe(true);
    await app.close();
  });

  it("409 already_imported when original name exists and no replace; removes temp file", async () => {
    const { app } = await build(0, { rows: 10, lastIngestedAt: "2026-05-16 00:00:00" });
    const f = form("dados.csv", CSV);
    const res = await app.inject({ method: "POST", url: "/api/upload", payload: f, headers: f.getHeaders() });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "already_imported", rows: 10 });
    expect(readdirSync(dir).length).toBe(0);
    await app.close();
  });

  it("replace=1 ingests even if original name exists", async () => {
    const { app, repo } = await build(0, { rows: 10, lastIngestedAt: "2026-05-16 00:00:00" });
    const f = form("dados.csv", CSV);
    const res = await app.inject({ method: "POST", url: "/api/upload?replace=1", payload: f, headers: f.getHeaders() });
    expect(res.statusCode).toBe(202);
    for (let i = 0; i < 50; i++) { if (repo.inserted.length >= 1) break; await new Promise((x) => setTimeout(x, 20)); }
    expect((repo.inserted[0] as { source_file: string }).source_file).toBe("dados.csv");
    expect(readdirSync(dir).length).toBe(1);
    await app.close();
  });

  it("removes temp file and 500s if fileStats throws (no orphan)", async () => {
    const app = Fastify();
    await app.register(multipart);
    const jobs = new JobStore();
    const repo = {
      inserted: [] as unknown[],
      deleteByFileName: async () => {},
      insertRows: async () => {},
      fileStats: async () => { throw new Error("clickhouse down"); },
    };
    registerUpload(app, {
      cfg: { UPLOAD_DIR: dir, INGEST_BATCH_SIZE: 100, MAX_UPLOAD_BYTES: 0 } as never,
      repo: repo as never,
      jobs,
    });
    const f = form("dados.csv", CSV);
    const res = await app.inject({ method: "POST", url: "/api/upload", payload: f, headers: f.getHeaders() });
    expect(res.statusCode).toBe(500);
    expect(readdirSync(dir).length).toBe(0);
    await app.close();
  });

  it("job.file is the original name (not the unique disk name)", async () => {
    const { app } = await build();
    const f = form("dados.csv", CSV);
    const start = await app.inject({ method: "POST", url: "/api/upload", payload: f, headers: f.getHeaders() });
    const { jobId } = start.json() as { jobId: string };
    let file = "";
    for (let i = 0; i < 50; i++) {
      const r = await app.inject({ method: "GET", url: `/api/import/${jobId}` });
      const j = r.json() as { status: string; file: string };
      file = j.file;
      if (j.status !== "running") break;
      await new Promise((x) => setTimeout(x, 20));
    }
    expect(file).toBe("dados.csv");
    await app.close();
  });
});
