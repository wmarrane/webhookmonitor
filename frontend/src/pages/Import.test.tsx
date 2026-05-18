import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Import } from "./Import.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  vi.spyOn(api, "imports").mockResolvedValue({ files: [] });
});

describe("Import", () => {
  it("server file: not imported -> imports directly and shows ProgressMonitor done", async () => {
    vi.spyOn(api, "files").mockResolvedValue([{ name: "sample.csv", size: 10, modified: "2026-05-16T00:00:00Z" }]);
    vi.spyOn(api, "importExists").mockResolvedValue({ exists: false, rows: 0, lastIngestedAt: "" });
    const startSpy = vi.spyOn(api, "startImport").mockResolvedValue({ jobId: "job-1" });
    vi.spyOn(api, "importStatus").mockResolvedValue({ id: "job-1", file: "sample.csv", status: "done", rowsProcessed: 3, rowsInserted: 3, parseErrors: 0, error: null, startedAt: "2026-05-16 10:00:00", finishedAt: "2026-05-16 10:00:01" });

    render(<Import />);
    await waitFor(() => expect(screen.getByText("sample.csv")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /importar/i }));
    await waitFor(() => expect(screen.getByText(/Ingest[aã]o conclu/i)).toBeInTheDocument(), { timeout: 5000 });
    expect(startSpy).toHaveBeenCalledWith("sample.csv", false);
  });

  it("server file: already imported -> shows warning, confirm reprocess sends replace=true", async () => {
    vi.spyOn(api, "files").mockResolvedValue([{ name: "sample.csv", size: 10, modified: "2026-05-16T00:00:00Z" }]);
    vi.spyOn(api, "importExists").mockResolvedValue({ exists: true, rows: 686181, lastIngestedAt: "2026-05-16 23:42:32" });
    const startSpy = vi.spyOn(api, "startImport").mockResolvedValue({ jobId: "job-2" });
    vi.spyOn(api, "importStatus").mockResolvedValue({ id: "job-2", file: "sample.csv", status: "done", rowsProcessed: 1, rowsInserted: 1, parseErrors: 0, error: null, startedAt: "2026-05-16 10:00:00", finishedAt: "2026-05-16 10:00:01" });

    render(<Import />);
    await waitFor(() => expect(screen.getByText("sample.csv")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /importar/i }));
    await waitFor(() => expect(screen.getByText(/já foi importado/i)).toBeInTheDocument());
    expect(screen.getByTestId("reprocess-warning")).toHaveTextContent("686181");
    expect(startSpy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /reprocessar/i }));
    expect(startSpy).toHaveBeenCalledWith("sample.csv", true);
    await waitFor(() => expect(screen.getByText(/Ingest[aã]o conclu/i)).toBeInTheDocument(), { timeout: 5000 });
  });

  it("upload: already imported -> warning, cancel does not upload", async () => {
    vi.spyOn(api, "files").mockResolvedValue([]);
    vi.spyOn(api, "importExists").mockResolvedValue({ exists: true, rows: 9, lastIngestedAt: "2026-05-16 00:00:00" });
    const upSpy = vi.spyOn(api, "uploadFile").mockResolvedValue("job-7");

    render(<Import />);
    const input = await screen.findByLabelText(/arquivo do meu computador/i) as HTMLInputElement;
    await userEvent.upload(input, new File(["a\n"], "u.csv", { type: "text/csv" }));
    await userEvent.click(screen.getByRole("button", { name: /enviar/i }));
    await waitFor(() => expect(screen.getByText(/já foi importado/i)).toBeInTheDocument());
    expect(upSpy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /cancelar/i }));
    await waitFor(() => expect(screen.queryByText(/já foi importado/i)).toBeNull());
    expect(upSpy).not.toHaveBeenCalled();
  });

  it("server file: already imported -> cancel does not import and clears warning", async () => {
    vi.spyOn(api, "files").mockResolvedValue([{ name: "sample.csv", size: 10, modified: "2026-05-16T00:00:00Z" }]);
    vi.spyOn(api, "importExists").mockResolvedValue({ exists: true, rows: 42, lastIngestedAt: "2026-05-16 00:00:00" });
    const startSpy = vi.spyOn(api, "startImport").mockResolvedValue({ jobId: "job-x" });

    render(<Import />);
    await waitFor(() => expect(screen.getByText("sample.csv")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /importar/i }));
    await waitFor(() => expect(screen.getByText(/já foi importado/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /cancelar/i }));
    await waitFor(() => expect(screen.queryByText(/já foi importado/i)).toBeNull());
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('imported panel lists files with rows/date and status "Concluído"', async () => {
    vi.spyOn(api, "files").mockResolvedValue([]);
    vi.spyOn(api, "imports").mockResolvedValue({
      files: [{ file: "Consultaderequestsresultados635.csv", rows: 686181, lastIngestedAt: "2026-05-17 02:51:52" }],
    });
    render(<Import />);
    await waitFor(() =>
      expect(screen.getByText("Consultaderequestsresultados635.csv")).toBeInTheDocument(),
    );
    expect(screen.getByText("2026-05-17 02:51:52")).toBeInTheDocument();
    expect(screen.getByText("Concluído")).toBeInTheDocument();
  });

  it('imported panel shows "Importando…" while a matching job runs', async () => {
    vi.spyOn(api, "files").mockResolvedValue([{ name: "x.csv", size: 10, modified: "2026-05-16T00:00:00Z" }]);
    vi.spyOn(api, "imports").mockResolvedValue({
      files: [{ file: "x.csv", rows: 100, lastIngestedAt: "2026-05-16 00:00:00" }],
    });
    vi.spyOn(api, "importExists").mockResolvedValue({ exists: false, rows: 0, lastIngestedAt: "" });
    vi.spyOn(api, "startImport").mockResolvedValue({ jobId: "job-9" });
    vi.spyOn(api, "importStatus").mockResolvedValue({ id: "job-9", file: "x.csv", status: "running", rowsProcessed: 1, rowsInserted: 0, parseErrors: 0, error: null, startedAt: "2026-05-16 10:00:00", finishedAt: null });
    render(<Import />);
    await waitFor(() => expect(screen.getByRole("button", { name: /importar/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /importar/i }));
    await waitFor(() => expect(screen.getByText(/Importando/)).toBeInTheDocument(), { timeout: 5000 });
  });

  it('imported panel shows "Falhou" when the matching job failed', async () => {
    vi.spyOn(api, "files").mockResolvedValue([{ name: "y.csv", size: 10, modified: "2026-05-16T00:00:00Z" }]);
    vi.spyOn(api, "imports").mockResolvedValue({
      files: [{ file: "y.csv", rows: 0, lastIngestedAt: "2026-05-16 00:00:00" }],
    });
    vi.spyOn(api, "importExists").mockResolvedValue({ exists: false, rows: 0, lastIngestedAt: "" });
    vi.spyOn(api, "startImport").mockResolvedValue({ jobId: "job-f" });
    vi.spyOn(api, "importStatus").mockResolvedValue({ id: "job-f", file: "y.csv", status: "failed", rowsProcessed: 0, rowsInserted: 0, parseErrors: 0, error: "boom", startedAt: "2026-05-16 10:00:00", finishedAt: "2026-05-16 10:00:01" });
    render(<Import />);
    await waitFor(() => expect(screen.getByRole("button", { name: /importar/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /importar/i }));
    await waitFor(() => expect(screen.getByText("Falhou")).toBeInTheDocument(), { timeout: 5000 });
  });

  it("reloads the imported list after a job finishes", async () => {
    vi.spyOn(api, "files").mockResolvedValue([{ name: "z.csv", size: 10, modified: "2026-05-16T00:00:00Z" }]);
    const importsSpy = vi
      .spyOn(api, "imports")
      .mockResolvedValueOnce({ files: [] })
      .mockResolvedValue({ files: [{ file: "z.csv", rows: 7, lastIngestedAt: "2026-05-16 11:00:00" }] });
    vi.spyOn(api, "importExists").mockResolvedValue({ exists: false, rows: 0, lastIngestedAt: "" });
    vi.spyOn(api, "startImport").mockResolvedValue({ jobId: "job-z" });
    vi.spyOn(api, "importStatus").mockResolvedValue({ id: "job-z", file: "z.csv", status: "done", rowsProcessed: 7, rowsInserted: 7, parseErrors: 0, error: null, startedAt: "2026-05-16 10:00:00", finishedAt: "2026-05-16 10:00:01" });
    render(<Import />);
    await waitFor(() => expect(screen.getByRole("button", { name: /importar/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /importar/i }));
    // "2026-05-16 11:00:00" is the lastIngestedAt for z.csv — only appears in the imported-files panel after reload
    await waitFor(() => expect(screen.getByText("2026-05-16 11:00:00")).toBeInTheDocument(), { timeout: 5000 });
    expect(importsSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
