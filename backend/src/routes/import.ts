import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { JobStore } from "../ingest/jobStore.js";
import { startIngestJob, type IngestJobRepo } from "../ingest/runJob.js";

interface Deps {
  cfg: Pick<AppConfig, "CARGAS_DIR" | "INGEST_BATCH_SIZE">;
  repo: IngestJobRepo;
  jobs: JobStore;
}

export function registerImport(app: FastifyInstance, deps: Deps): void {
  app.post<{ Body: { file?: string } }>("/api/import", async (req, reply) => {
    const requested = req.body?.file ?? "";
    const safe = basename(requested);
    if (
      !safe ||
      safe !== requested ||
      !safe.toLowerCase().endsWith(".csv")
    ) {
      return reply.code(400).send({ error: "bad_request", message: "invalid file name" });
    }
    const full = join(deps.cfg.CARGAS_DIR, safe);
    if (!existsSync(full)) {
      return reply.code(400).send({ error: "not_found", message: "file not found in cargas" });
    }

    const job = deps.jobs.create(safe);
    reply.code(202).send({ jobId: job.id });

    startIngestJob({
      jobs: deps.jobs,
      jobId: job.id,
      repo: deps.repo,
      filePath: full,
      batchSize: deps.cfg.INGEST_BATCH_SIZE,
    });
  });

  app.get<{ Params: { id: string } }>("/api/import/:id", async (req, reply) => {
    const job = deps.jobs.get(req.params.id);
    if (!job) return reply.code(404).send({ error: "not_found", message: "job not found" });
    return job;
  });
}
