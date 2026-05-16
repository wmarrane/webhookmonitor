import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { Dashboard } from "./Dashboard.js";

afterEach(() => vi.restoreAllMocks());

describe("Dashboard", () => {
  it("renders total and charts after loading stats", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            byDay: [{ day: "2026-05-15", total: "2" }],
            byScript: [{ tipo_script: "Evento de usuário", total: "2" }],
            byTitulo: [{ titulo: "nr", total: "2" }],
            total: 2,
          }),
          { status: 200 },
        ),
      ),
    );
    render(<Dashboard />);
    const label = await waitFor(() =>
      screen.getByText(/total de requests/i),
    );
    // The fixture's total, byScript.total and byTitulo.total are all "2",
    // so getByText("2") is ambiguous. Scope to the total card to assert the
    // total figure is rendered (asserted behavior unchanged: total === 2 shown).
    const totalCard = label.closest("div") as HTMLElement;
    expect(within(totalCard).getByText("2")).toBeInTheDocument();
  });
});
