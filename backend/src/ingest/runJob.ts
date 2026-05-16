import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { ingestCsv } from "./ingestService.js";
import type { JobStore } from "./jobStore.js";

export interface IngestJobRepo {
  deleteByFileName: (file: string) => Promise<void>;
  insertRows: (rows: unknown[]) => Promise<void>;
}

export interface StartIngestJobOptions {
  jobs: JobStore;
  jobId: string;
  repo: IngestJobRepo;
  filePath: string;
  batchSize: number;
}

/**
 * Fire-and-forget: roda o ingest de filePath e atualiza o job.
 * source_file no ClickHouse é basename(filePath) (igual ao ingestCsv),
 * então deleteByFileName usa o mesmo basename para o "replace por arquivo".
 */
export function startIngestJob(opts: StartIngestJobOptions): void {
  const sourceName = basename(opts.filePath);
  void (async () => {
    try {
      await opts.repo.deleteByFileName(sourceName);
      let firstInsertError: string | null = null;
      const result = await ingestCsv({
        filePath: opts.filePath,
        ingestBatch: randomUUID(),
        batchSize: opts.batchSize,
        insert: async (rows) => {
          await opts.repo.insertRows(rows);
        },
        onProgress: (p) => opts.jobs.update(opts.jobId, p),
        onError: (err) => {
          if (firstInsertError === null) {
            firstInsertError = err instanceof Error ? err.message : String(err);
          }
        },
      });
      opts.jobs.update(opts.jobId, result);
      if (result.rowsInserted === 0 && result.rowsProcessed > 0) {
        opts.jobs.finish(opts.jobId, "failed", firstInsertError ?? "no rows were inserted");
      } else {
        opts.jobs.finish(opts.jobId, "done");
      }
    } catch (err) {
      opts.jobs.finish(
        opts.jobId,
        "failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  })();
}
