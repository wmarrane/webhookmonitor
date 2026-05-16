export interface RequestRow {
  id_interno: number;
  event_ts: string;        // "YYYY-MM-DD HH:MM:SS" (ClickHouse DateTime)
  nome: string;
  titulo: string;
  tipo: string;
  tipo_script: string;
  detalhes: string;        // raw JSON string (may be empty)
  txn_id: string;
  txn_type: string;
  integra_id: string;
  status: string;          // 'unknown' for now
  ingest_batch: string;    // UUID
  ingested_at: string;     // "YYYY-MM-DD HH:MM:SS"
}

export interface ImportJob {
  id: string;
  file: string;
  status: "running" | "done" | "failed";
  rowsProcessed: number;
  rowsInserted: number;
  parseErrors: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}
