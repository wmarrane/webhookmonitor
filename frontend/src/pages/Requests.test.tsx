import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Requests } from "./Requests.js";

afterEach(() => vi.restoreAllMocks());

const listResponse = {
  data: [{
    id_interno: 3262308, event_ts: "2026-05-15 01:06:00",
    nome: "[CCC] MSG", titulo: "nr", tipo: "Depurar",
    tipo_script: "Evento de usuário", txn_id: "360738",
    txn_type: "invoice", integra_id: "38967664", status: "unknown",
  }],
  total: 1, page: 1, pageSize: 25,
};

describe("Requests", () => {
  it("loads rows, links txn_id to the transaction trace, and opens the JSON drill-down from id_interno", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(listResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_interno: 3262308, detalhes: "{\"id\":\"360738\"}" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><Requests /></MemoryRouter>);

    // row loaded: txn_id rendered as a navigation link
    await waitFor(() => expect(screen.getByText("360738")).toBeInTheDocument());
    const txnLink = screen.getByRole("link", { name: "360738" });
    expect(txnLink).toHaveAttribute("href", "/transactions/360738");

    // drill-down opens from the id_interno button, shows formatted payload
    await userEvent.click(screen.getByRole("button", { name: "3262308" }));
    await waitFor(() =>
      expect(screen.getByText(/"id": "360738"/)).toBeInTheDocument(),
    );
  });
});
