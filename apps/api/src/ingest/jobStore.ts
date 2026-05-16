import { randomUUID } from "node:crypto";
import type { ImportJob } from "../types.js";

function now(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export class JobStore {
  private jobs = new Map<string, ImportJob>();

  create(file: string): ImportJob {
    const job: ImportJob = {
      id: randomUUID(),
      file,
      status: "running",
      rowsProcessed: 0,
      rowsInserted: 0,
      parseErrors: 0,
      error: null,
      startedAt: now(),
      finishedAt: null,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): ImportJob | undefined {
    return this.jobs.get(id);
  }

  update(id: string, patch: Partial<ImportJob>): void {
    const job = this.jobs.get(id);
    if (job) Object.assign(job, patch);
  }

  finish(id: string, status: "done" | "failed", error: string | null = null): void {
    const job = this.jobs.get(id);
    if (job) {
      job.status = status;
      job.error = error;
      job.finishedAt = now();
    }
  }
}
