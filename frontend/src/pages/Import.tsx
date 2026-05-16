import { useEffect, useRef, useState } from "react";
import { api, type FileInfo, type ImportJob } from "../api/client.js";
import { AsyncState } from "../components/AsyncState.js";

export function Import() {
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.files().then(setFiles).catch((e: Error) => setError(e.message));
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const start = async (file: string) => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    setJob(null);
    setError(null);
    try {
      const { jobId } = await api.startImport(file);
      timer.current = setInterval(async () => {
        try {
          const j = await api.importStatus(jobId);
          setJob(j);
          if (j.status !== "running" && timer.current) {
            clearInterval(timer.current);
            timer.current = null;
          }
        } catch (e) {
          if (timer.current) {
            clearInterval(timer.current);
            timer.current = null;
          }
          setError(e instanceof Error ? e.message : String(e));
        }
      }, 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-4">
      <AsyncState
        loading={!files && !error}
        error={error}
        empty={!!files && files.length === 0}
      >
        {files && (
          <table className="w-full bg-white text-sm shadow">
            <thead className="bg-slate-100 text-left">
              <tr><th className="p-2">Arquivo</th><th className="p-2">Tamanho</th><th className="p-2"></th></tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.name} className="border-b">
                  <td className="p-2">{f.name}</td>
                  <td className="p-2">{(f.size / 1_048_576).toFixed(1)} MB</td>
                  <td className="p-2">
                    <button
                      className="rounded bg-slate-900 px-3 py-1 text-white"
                      onClick={() => start(f.name)}
                    >
                      Importar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </AsyncState>

      {job && (
        <div className="rounded bg-white p-4 shadow text-sm">
          <p>Arquivo: <b>{job.file}</b></p>
          <p>Status: <b>{job.status}</b></p>
          <p>Linhas processadas: {job.rowsProcessed}</p>
          <p>Linhas inseridas: {job.rowsInserted}</p>
          <p>Erros: {job.parseErrors}</p>
          {job.error && <p className="text-red-600">Erro: {job.error}</p>}
        </div>
      )}
    </div>
  );
}
