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
  it("loads and displays rows; opens drill-down", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(listResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_interno: 3262308, detalhes: "{\"id\":\"360738\"}" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><Requests /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("360738")).toBeInTheDocument());

    await userEvent.click(screen.getByText("360738"));
    await waitFor(() =>
      expect(screen.getByText(/"id": "360738"/)).toBeInTheDocument(),
    );
  });
});
