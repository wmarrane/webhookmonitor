const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function errMessage(res: Response, path: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    if (body && typeof body.message === "string" && body.message) return body.message;
  } catch {
    /* non-JSON body */
  }
  return `API ${res.status}: ${path}`;
}

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
  if (!res.ok) throw new Error(await errMessage(res, path));
  return (await res.json()) as T;
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errMessage(res, path));
  return (await res.json()) as T;
}

export interface UploadProgress { loaded: number; total: number; }
export interface ImportExists { exists: boolean; rows: number; lastIngestedAt: string; }

function uploadFile(
  file: File,
  onProgress?: (p: UploadProgress) => void,
  replace = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/api/upload${replace ? "?replace=1" : ""}`);
    xhr.upload.addEventListener("progress", (e: ProgressEvent) => {
      if (e.lengthComputable && onProgress) onProgress({ loaded: e.loaded, total: e.total });
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve((JSON.parse(xhr.responseText) as { jobId: string }).jobId);
        } catch {
          reject(new Error("invalid upload response"));
        }
      } else {
        let msg = `API ${xhr.status}: /api/upload`;
        try {
          const b = JSON.parse(xhr.responseText) as { message?: string };
          if (b && typeof b.message === "string" && b.message) msg = b.message;
        } catch {
          /* non-JSON */
        }
        reject(new Error(msg));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("upload network error")));
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}

export const api = {
  health: () => get<{ status: string; clickhouse: boolean }>("/api/health"),
  files: () => get<FileInfo[]>("/api/files"),
  startImport: (file: string, replace = false) =>
    post<{ jobId: string }>("/api/import", { file, replace }),
  importExists: (file: string) =>
    get<ImportExists>(`/api/imports/exists?file=${encodeURIComponent(file)}`),
  importStatus: (id: string) => get<ImportJob>(`/api/import/${id}`),
  stats: (qs = "") => get<Stats>(`/api/stats${qs}`),
  requests: (qs = "") => get<ListResult>(`/api/requests${qs}`),
  request: (id: number) => get<Record<string, unknown>>(`/api/requests/${id}`),
  transaction: (txn: string) => get<RequestSummary[]>(`/api/transactions/${encodeURIComponent(txn)}`),
  uploadFile,
};
