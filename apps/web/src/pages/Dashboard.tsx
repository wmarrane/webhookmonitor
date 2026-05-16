import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { api, type Stats } from "../api/client.js";
import { AsyncState } from "../components/AsyncState.js";

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <AsyncState
      loading={!stats && !error}
      error={error}
      empty={!!stats && stats.total === 0}
    >
      {stats && (
        <div className="space-y-6">
          <div className="rounded bg-white p-4 shadow">
            <p className="text-sm text-slate-500">Total de requests</p>
            <p className="text-3xl font-bold">{stats.total}</p>
          </div>
          <div className="rounded bg-white p-4 shadow">
            <h2 className="mb-2 font-semibold">Volume por dia</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats.byDay.map((d) => ({ day: d.day, total: Number(d.total) }))}>
                <XAxis dataKey="day" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="total" fill="#0f172a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded bg-white p-4 shadow">
              <h2 className="mb-2 font-semibold">Por tipo de script</h2>
              <ul className="text-sm">
                {stats.byScript.map((s) => (
                  <li key={s.tipo_script} className="flex justify-between border-b py-1">
                    <span>{s.tipo_script || "(vazio)"}</span><span>{s.total}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded bg-white p-4 shadow">
              <h2 className="mb-2 font-semibold">Por título</h2>
              <ul className="text-sm">
                {stats.byTitulo.map((s) => (
                  <li key={s.titulo} className="flex justify-between border-b py-1">
                    <span>{s.titulo || "(vazio)"}</span><span>{s.total}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </AsyncState>
  );
}
