import { basename, extname, join } from "node:path";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import "@fastify/multipart"; // loads the FastifyRequest module augmentation (req.file)
import type { AppConfig } from "../config.js";
import type { JobStore } from "../ingest/jobStore.js";
import { startIngestJob, type IngestJobRepo } from "../ingest/runJob.js";

interface Deps {
  cfg: Pick<AppConfig, "UPLOAD_DIR" | "INGEST_BATCH_SIZE" | "MAX_UPLOAD_BYTES">;
  repo: IngestJobRepo;
  jobs: JobStore;
}

export function registerUpload(
  app: FastifyInstance,
  deps: Deps,
  opts: { statusRoute?: boolean } = {},
): void {
  app.post<{ Querystring: { replace?: string } }>("/api/upload", async (req, reply) => {
    // MAX_UPLOAD_BYTES=0 means "no limit". @fastify/multipart otherwise falls
    // back to Fastify's bodyLimit (1 MB) as the per-file fileSize cap, which
    // would silently truncate large uploads — so pass Infinity explicitly.
    const fileSize =
      deps.cfg.MAX_UPLOAD_BYTES > 0 ? deps.cfg.MAX_UPLOAD_BYTES : Infinity;
    const part = await req.file({
      limits: { fileSize },
      throwFileSizeLimit: false,
    });

    if (!part || !part.filename) {
      return reply.code(400).send({ error: "bad_request", message: "no file part" });
    }
    const original = basename(part.filename);
    if (!original.toLowerCase().endsWith(".csv")) {
      part.file.resume();
      return reply.code(400).send({ error: "bad_request", message: "only .csv files are accepted" });
    }

    const stem = basename(original, extname(original)).replace(/[^A-Za-z0-9._-]/g, "_");
    const unique = `${stem}-${Date.now()}-${randomBytes(4).toString("hex")}.csv`;
    const dest = join(deps.cfg.UPLOAD_DIR, unique);

    try {
      await pipeline(part.file, createWriteStream(dest));
    } catch (err) {
      await unlink(dest).catch(() => {});
      throw err;
    }

    if (part.file.truncated) {
      await unlink(dest).catch(() => {});
      return reply.code(413).send({ error: "too_large", message: "file exceeds MAX_UPLOAD_BYTES" });
    }

    const replace = req.query.replace === "1";
    if (!replace) {
      let stats: { rows: number; lastIngestedAt: string };
      try {
        stats = await deps.repo.fileStats(original);
      } catch (err) {
        await unlink(dest).catch(() => {});
        throw err;
      }
      if (stats.rows > 0) {
        await unlink(dest).catch(() => {});
        return reply.code(409).send({
          error: "already_imported",
          message: `file already imported (${stats.rows} rows)`,
          rows: stats.rows,
          lastIngestedAt: stats.lastIngestedAt,
        });
      }
    }

    const job = deps.jobs.create(original);
    reply.code(202).send({ jobId: job.id });

    startIngestJob({
      jobs: deps.jobs,
      jobId: job.id,
      repo: deps.repo,
      filePath: dest,
      sourceName: original,
      batchSize: deps.cfg.INGEST_BATCH_SIZE,
    });
  });

  // GET /api/import/:id is also provided by registerImport. In production
  // (index.ts) registerUpload is called with { statusRoute: false } to avoid
  // duplicate route registration; statusRoute defaults true so the upload
  // route is self-contained when used in isolation (e.g. tests).
  if (opts.statusRoute !== false) {
    app.get<{ Params: { id: string } }>("/api/import/:id", async (req, reply) => {
      const job = deps.jobs.get(req.params.id);
      if (!job) return reply.code(404).send({ error: "not_found", message: "job not found" });
      return job;
    });
  }
}
