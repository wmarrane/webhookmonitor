import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { mapRow, type CsvRecord } from "../csv/rowMapper.js";
import type { RequestRow } from "../types.js";
import { now } from "../time.js";

export interface IngestOptions {
  filePath: string;
  ingestBatch: string;
  batchSize: number;
  insert: (rows: RequestRow[]) => Promise<void>;
  onProgress?: (p: {
    rowsProcessed: number;
    rowsInserted: number;
    parseErrors: number;
  }) => void;
  onError?: (err: unknown, batchSize: number) => void;
}

export interface IngestResult {
  rowsProcessed: number;
  rowsInserted: number;
  parseErrors: number;
}

export async function ingestCsv(opts: IngestOptions): Promise<IngestResult> {
  const ingestedAt = now();
  let rowsProcessed = 0;
  let rowsInserted = 0;
  let parseErrors = 0;
  let batch: RequestRow[] = [];

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const toInsert = batch;
    batch = [];
    try {
      await opts.insert(toInsert);
      rowsInserted += toInsert.length;
    } catch (err) {
      parseErrors += toInsert.length;
      opts.onError?.(err, toInsert.length);
    }
    opts.onProgress?.({ rowsProcessed, rowsInserted, parseErrors });
  };

  const parser = createReadStream(opts.filePath).pipe(
    parse({
      columns: true,
      bom: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: false,
    }),
  );

  for await (const record of parser as AsyncIterable<CsvRecord>) {
    rowsProcessed += 1;
    try {
      batch.push(mapRow(record, opts.ingestBatch, ingestedAt));
    } catch {
      parseErrors += 1;
      continue;
    }
    if (batch.length >= opts.batchSize) await flush();
  }
  await flush();

  return { rowsProcessed, rowsInserted, parseErrors };
}
