import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api, type ListResult } from "../api/client.js";
import { AsyncState } from "../components/AsyncState.js";
import { JsonViewer } from "../components/JsonViewer.js";

export function Requests() {
  const [result, setResult] = useState<ListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ tipo: "", titulo: "", status: "", q: "" });
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(() => {
    setResult(null);
    setError(null);
    const qs = new URLSearchParams(
      Object.entries({ ...filters, page: String(page), pageSize: "25" })
        .filter(([, v]) => v !== ""),
    ).toString();
    api.requests(`?${qs}`).then(setResult).catch((e: Error) => setError(e.message));
  }, [filters, page]);

  useEffect(load, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["tipo", "titulo", "status", "q"] as const).map((k) => (
          <input
            key={k}
            placeholder={k === "q" ? "busca (id/integra_id/texto)" : k}
            className="rounded border px-2 py-1 text-sm"
            value={filters[k]}
            onChange={(e) => setFilters((f) => ({ ...f, [k]: e.target.value }))}
          />
        ))}
        <button
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white"
          onClick={() => { setPage(1); load(); }}
        >
          Filtrar
        </button>
      </div>

      <AsyncState
        loading={!result && !error}
        error={error}
        empty={!!result && result.data.length === 0}
      >
        {result && (
          <>
            <table className="w-full border-collapse bg-white text-sm shadow">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="p-2">ID interno</th><th className="p-2">Data/Hora</th>
                  <th className="p-2">Título</th><th className="p-2">Tipo</th>
                  <th className="p-2">txn_id</th><th className="p-2">integra_id</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((r) => (
                  <tr key={r.id_interno} className="border-b hover:bg-slate-50">
                    <td className="p-2">
                      <button
                        className="text-blue-700 underline"
                        onClick={() =>
                          api.request(r.id_interno).then(setDetail).catch(() => {})
                        }
                      >
                        {r.id_interno}
                      </button>
                    </td>
                    <td className="p-2">{r.event_ts}</td>
                    <td className="p-2">{r.titulo}</td>
                    <td className="p-2">{r.tipo}</td>
                    <td className="p-2">
                      {r.txn_id ? (
                        <span className="flex items-center gap-1">
                          <button
                            className="text-blue-700 underline"
                            onClick={() =>
                              api.request(r.id_interno).then(setDetail).catch(() => {})
                            }
                          >
                            {r.txn_id}
                          </button>
                          <Link
                            className="text-xs text-slate-500 underline"
                            to={`/transactions/${r.txn_id}`}
                            aria-label={`Abrir transação ${r.txn_id}`}
                          >
                            ↗
                          </Link>
                        </span>
                      ) : "—"}
                    </td>
                    <td className="p-2">{r.integra_id || "—"}</td>
                    <td className="p-2">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex items-center gap-3 text-sm">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                className="rounded border px-2 py-1 disabled:opacity-40">Anterior</button>
              <span>Página {result.page} — {result.total} registros</span>
              <button disabled={page * result.pageSize >= result.total}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border px-2 py-1 disabled:opacity-40">Próxima</button>
            </div>
          </>
        )}
      </AsyncState>

      {detail && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 p-6"
          onClick={() => setDetail(null)}>
          <div className="w-full max-w-3xl rounded bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-between">
              <h3 className="font-semibold">Payload do request</h3>
              <button onClick={() => setDetail(null)}>✕</button>
            </div>
            <JsonViewer value={detail.detalhes ?? detail} />
          </div>
        </div>
      )}
    </div>
  );
}
