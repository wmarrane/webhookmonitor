import type { RequestRow } from "../types.js";
import { parseDateBR } from "./parseDateBR.js";
import { extractFields } from "./extractFields.js";

export type CsvRecord = Record<string, string | undefined>;

export function mapRow(
  rec: CsvRecord,
  ingestBatch: string,
  ingestedAt: string,
  sourceFile: string,
): RequestRow {
  const detalhes = rec["Detalhes"] ?? "";
  const f = extractFields(detalhes);
  const idNum = Number.parseInt((rec["ID interno"] ?? "").trim(), 10);
  return {
    id_interno: Number.isFinite(idNum) ? idNum : 0,
    event_ts: parseDateBR(rec["Data"] ?? "", rec["Hora"] ?? ""),
    nome: (rec["Nome"] ?? "").trim(),
    titulo: (rec["Título"] ?? "").trim(),
    tipo: (rec["Tipo"] ?? "").trim(),
    tipo_script: (rec["Tipo de script"] ?? "").trim(),
    detalhes,
    txn_id: f.txn_id,
    txn_type: f.txn_type,
    integra_id: f.integra_id,
    status: "unknown",
    ingest_batch: ingestBatch,
    ingested_at: ingestedAt,
    source_file: sourceFile,
  };
}
