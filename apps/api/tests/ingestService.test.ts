import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ingestCsv } from "../src/ingest/ingestService.js";
import type { RequestRow } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const sample = join(here, "fixtures", "sample.csv");

describe("ingestCsv", () => {
  it("streams the CSV, maps rows, and batches inserts", async () => {
    const batches: RequestRow[][] = [];
    const res = await ingestCsv({
      filePath: sample,
      ingestBatch: "batch-xyz",
      batchSize: 2,
      insert: async (rows) => {
        batches.push(rows.map((r) => ({ ...r })));
      },
    });

    expect(res.rowsProcessed).toBe(3);
    expect(res.rowsInserted).toBe(3);
    expect(res.parseErrors).toBe(0);
    expect(batches.map((b) => b.length)).toEqual([2, 1]);

    const all = batches.flat();
    expect(all[0].txn_id).toBe("360738");
    expect(all[0].integra_id).toBe("38967664");
    expect(all[1].titulo).toBe("pymtChargeback");
    expect(all[1].detalhes).toBe("");
    expect(all[1].txn_id).toBe("");
    expect(all[2].txn_id).toBe("3341422");
  });

  it("counts insert failures into parseErrors and continues", async () => {
    let calls = 0;
    const res = await ingestCsv({
      filePath: sample,
      ingestBatch: "b",
      batchSize: 1,
      insert: async () => {
        calls += 1;
        if (calls === 2) throw new Error("clickhouse down");
      },
    });
    expect(res.rowsProcessed).toBe(3);
    expect(res.rowsInserted).toBe(2);
    expect(res.parseErrors).toBe(1);
  });
});
