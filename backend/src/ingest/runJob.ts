import { randomUUID } from "node:crypto";
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
  sourceName: string;
  batchSize: number;
}

/** Fire-and-forget: ingere filePath, grava source_file = sourceName, e deleteByFileName(sourceName) faz o "replace por arquivo". */
export function startIngestJob(opts: StartIngestJobOptions): void {
  void (async () => {
    try {
      await opts.repo.deleteByFileName(opts.sourceName);
      let firstInsertError: string | null = null;
      const result = await ingestCsv({
        filePath: opts.filePath,
        ingestBatch: randomUUID(),
        sourceName: opts.sourceName,
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
