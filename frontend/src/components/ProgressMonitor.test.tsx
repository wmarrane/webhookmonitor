import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressMonitor } from "./ProgressMonitor.js";
import type { ImportJob } from "../api/client.js";

const job = (over: Partial<ImportJob> = {}): ImportJob => ({
  id: "j", file: "x.csv", status: "running",
  rowsProcessed: 1200, rowsInserted: 1190, parseErrors: 10,
  error: null, startedAt: "2026-05-16 10:00:00", finishedAt: null, ...over,
});

describe("ProgressMonitor", () => {
  it("upload phase shows a determinate percentage", () => {
    render(<ProgressMonitor phase="upload" upload={{ loaded: 5, total: 10 }} job={null} />);
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  it("ingest phase shows live counters and NO percentage", () => {
    render(<ProgressMonitor phase="ingest" upload={null} job={job()} />);
    expect(screen.getByText(/1200/)).toBeInTheDocument();
    expect(screen.getByText(/1190/)).toBeInTheDocument();
    expect(screen.getByText(/10/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.getByText(/processa/i)).toBeInTheDocument();
  });

  it("done shows success summary", () => {
    render(<ProgressMonitor phase="ingest" upload={null} job={job({ status: "done", finishedAt: "2026-05-16 10:01:00" })} />);
    expect(screen.getByText(/conclu/i)).toBeInTheDocument();
  });

  it("failed shows the error", () => {
    render(<ProgressMonitor phase="ingest" upload={null} job={job({ status: "failed", error: "boom" })} />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
});
