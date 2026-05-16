import { describe, it, expect } from "vitest";
import { JobStore } from "../src/ingest/jobStore.js";

describe("JobStore", () => {
  it("creates a running job with a uuid id", () => {
    const s = new JobStore();
    const job = s.create("file.csv");
    expect(job.status).toBe("running");
    expect(job.file).toBe("file.csv");
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.get(job.id)).toEqual(job);
  });

  it("updates progress and finalizes", () => {
    const s = new JobStore();
    const job = s.create("f.csv");
    s.update(job.id, { rowsProcessed: 10, rowsInserted: 9, parseErrors: 1 });
    s.finish(job.id, "done");
    const got = s.get(job.id)!;
    expect(got.rowsProcessed).toBe(10);
    expect(got.status).toBe("done");
    expect(got.finishedAt).not.toBeNull();
  });

  it("returns undefined for unknown id", () => {
    expect(new JobStore().get("nope")).toBeUndefined();
  });
});
