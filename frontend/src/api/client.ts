const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export interface FileInfo { name: string; size: number; modified: string; }
export interface ImportJob {
  id: string; file: string;
  status: "running" | "done" | "failed";
  rowsProcessed: number; rowsInserted: number; parseErrors: number;
  error: string | null; startedAt: string; finishedAt: string | null;
}
export interface RequestSummary {
  id_interno: number; event_ts: string; nome: string; titulo: string;
  tipo: string; tipo_script: string; txn_id: string; txn_type: string;
  integra_id: string; status: string;
}
export interface ListResult {
  data: RequestSummary[]; total: number; page: number; pageSize: number;
}
export interface Stats {
  byDay: { day: string; total: string }[];
  byScript: { tipo_script: string; total: string }[];
  byTitulo: { titulo: string; total: string }[];
  total: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return (await res.json()) as T;
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return (await res.json()) as T;
}

export const api = {
  health: () => get<{ status: string; clickhouse: boolean }>("/api/health"),
  files: () => get<FileInfo[]>("/api/files"),
  startImport: (file: string) => post<{ jobId: string }>("/api/import", { file }),
  importStatus: (id: string) => get<ImportJob>(`/api/import/${id}`),
  stats: (qs = "") => get<Stats>(`/api/stats${qs}`),
  requests: (qs = "") => get<ListResult>(`/api/requests${qs}`),
  request: (id: number) => get<Record<string, unknown>>(`/api/requests/${id}`),
  transaction: (txn: string) => get<RequestSummary[]>(`/api/transactions/${encodeURIComponent(txn)}`),
};
