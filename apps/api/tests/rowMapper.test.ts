import { describe, it, expect } from "vitest";
import { mapRow } from "../src/csv/rowMapper.js";

const rec = {
  "ID interno": "3262308",
  Data: "15/05/2026",
  Hora: "1:06",
  Nome: "[CCC] MSG Transaction UE",
  "Título": "nr",
  Tipo: "Depurar",
  "Tipo de script": "Evento de usuário",
  Detalhes: JSON.stringify({
    id: "360738",
    type: "invoice",
    fields: { custbody_nst_integra_id_: "38967664" },
  }),
};

describe("mapRow", () => {
  it("maps a full record into a RequestRow", () => {
    const row = mapRow(rec, "batch-1", "2026-05-16 10:00:00");
    expect(row.id_interno).toBe(3262308);
    expect(row.event_ts).toBe("2026-05-15 01:06:00");
    expect(row.nome).toBe("[CCC] MSG Transaction UE");
    expect(row.titulo).toBe("nr");
    expect(row.tipo).toBe("Depurar");
    expect(row.tipo_script).toBe("Evento de usuário");
    expect(row.txn_id).toBe("360738");
    expect(row.txn_type).toBe("invoice");
    expect(row.integra_id).toBe("38967664");
    expect(row.status).toBe("unknown");
    expect(row.ingest_batch).toBe("batch-1");
    expect(row.ingested_at).toBe("2026-05-16 10:00:00");
  });

  it("handles empty Detalhes (e.g. pymtChargeback rows)", () => {
    const row = mapRow(
      { ...rec, "Título": "pymtChargeback", Detalhes: "" },
      "b",
      "2026-05-16 10:00:00",
    );
    expect(row.detalhes).toBe("");
    expect(row.txn_id).toBe("");
    expect(row.integra_id).toBe("");
  });

  it("defaults id_interno to 0 when not numeric", () => {
    const row = mapRow({ ...rec, "ID interno": "" }, "b", "2026-05-16 10:00:00");
    expect(row.id_interno).toBe(0);
  });
});
