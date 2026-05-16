import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Import } from "./Import.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

describe("Import", () => {
  it("lists files, starts import, shows ProgressMonitor until done", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ name: "sample.csv", size: 10, modified: "2026-05-16T00:00:00Z" }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "job-1" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", file: "sample.csv", status: "done", rowsProcessed: 3, rowsInserted: 3, parseErrors: 0, error: null, startedAt: "2026-05-16 10:00:00", finishedAt: "2026-05-16 10:00:01" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Import />);
    await waitFor(() => expect(screen.getByText("sample.csv")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /importar/i }));
    await waitFor(() => expect(screen.getByText(/Ingest[aã]o conclu/i)).toBeInTheDocument(), { timeout: 5000 });
  });

  it("uploads a chosen file then tracks ingestion", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-7", file: "u.csv", status: "done", rowsProcessed: 2, rowsInserted: 2, parseErrors: 0, error: null, startedAt: "2026-05-16 10:00:00", finishedAt: "2026-05-16 10:00:01" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const upSpy = vi.spyOn(api, "uploadFile").mockResolvedValue("job-7");

    render(<Import />);
    await waitFor(() => expect(screen.getByLabelText(/arquivo do meu computador/i)).toBeInTheDocument());
    const input = screen.getByLabelText(/arquivo do meu computador/i) as HTMLInputElement;
    const file = new File(["a,b\n1,2\n"], "u.csv", { type: "text/csv" });
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole("button", { name: /enviar/i }));
    expect(upSpy).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/Ingest[aã]o conclu/i)).toBeInTheDocument(), { timeout: 5000 });
  });

  it("upload failure resets to idle and surfaces the error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(api, "uploadFile").mockRejectedValue(new Error("network fail"));

    render(<Import />);
    await waitFor(() => expect(screen.getByLabelText(/arquivo do meu computador/i)).toBeInTheDocument());
    const input = screen.getByLabelText(/arquivo do meu computador/i) as HTMLInputElement;
    await userEvent.upload(input, new File(["a\n"], "u.csv", { type: "text/csv" }));
    await userEvent.click(screen.getByRole("button", { name: /enviar/i }));

    await waitFor(() => expect(screen.getByText(/network fail/i)).toBeInTheDocument());
    expect(screen.queryByText(/Ingest[aã]o/i)).toBeNull();
  });
});
