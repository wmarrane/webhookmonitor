import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type RequestSummary } from "../api/client.js";
import { AsyncState } from "../components/AsyncState.js";

export function Transaction() {
  const { txn } = useParams();
  const [events, setEvents] = useState<RequestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!txn) return;
    api.transaction(txn).then(setEvents).catch((e: Error) => setError(e.message));
  }, [txn]);

  return (
    <AsyncState
      loading={!events && !error}
      error={error}
      empty={!!events && events.length === 0}
    >
      {events && (
        <div className="space-y-2">
          <h2 className="font-semibold">Transação {txn}</h2>
          <ol className="border-l-2 border-slate-300 pl-4">
            {events.map((e) => (
              <li key={e.id_interno} className="mb-3">
                <p className="text-sm text-slate-500">{e.event_ts}</p>
                <p className="font-medium">{e.titulo} — {e.nome}</p>
                <p className="text-xs text-slate-600">
                  id_interno {e.id_interno} · {e.tipo_script} · status {e.status}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </AsyncState>
  );
}
