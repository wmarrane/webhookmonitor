import { useEffect, useRef, useState } from "react";
import { api, type FileInfo, type ImportJob, type UploadProgress } from "../api/client.js";
import { AsyncState } from "../components/AsyncState.js";
import { ProgressMonitor } from "../components/ProgressMonitor.js";

type Pending =
  | { kind: "server"; name: string; rows: number; lastIngestedAt: string }
  | { kind: "upload"; file: File; rows: number; lastIngestedAt: string };

export function Import() {
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [phase, setPhase] = useState<"idle" | "upload" | "ingest">("idle");
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.files().then(setFiles).catch((e: Error) => setError(e.message));
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const poll = (jobId: string) => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setPhase("ingest");
    timer.current = setInterval(async () => {
      try {
        const j = await api.importStatus(jobId);
        setJob(j);
        if (j.status !== "running" && timer.current) {
          clearInterval(timer.current); timer.current = null;
        }
      } catch (e) {
        if (timer.current) { clearInterval(timer.current); timer.current = null; }
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 1000);
  };

  const runServer = async (name: string, replace: boolean) => {
    setJob(null); setError(null); setUpload(null);
    try {
      const { jobId } = await api.startImport(name, replace);
      poll(jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runUpload = async (file: File, replace: boolean) => {
    setJob(null); setError(null); setUpload({ loaded: 0, total: file.size });
    setPhase("upload");
    try {
      const jobId = await api.uploadFile(file, (p) => setUpload(p), replace);
      poll(jobId);
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onImportServer = async (name: string) => {
    setError(null);
    try {
      const ex = await api.importExists(name);
      if (ex.exists) {
        setPending({ kind: "server", name, rows: ex.rows, lastIngestedAt: ex.lastIngestedAt });
      } else {
        await runServer(name, false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onSendUpload = async () => {
    if (!picked) return;
    setError(null);
    try {
      const ex = await api.importExists(picked.name);
      if (ex.exists) {
        setPending({ kind: "upload", file: picked, rows: ex.rows, lastIngestedAt: ex.lastIngestedAt });
      } else {
        await runUpload(picked, false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const confirmReprocess = async () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.kind === "server") await runServer(p.name, true);
    else await runUpload(p.file, true);
  };

  return (
    <div className="space-y-6">
      <section className="rounded bg-white p-4 shadow space-y-2">
        <h2 className="font-semibold">Enviar arquivo do meu computador</h2>
        <input
          aria-label="arquivo do meu computador"
          type="file"
          accept=".csv"
          onChange={(e) => setPicked(e.target.files?.[0] ?? null)}
        />
        <button
          className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-40"
          disabled={!picked || phase !== "idle" || pending !== null}
          onClick={onSendUpload}
        >
          Enviar
        </button>
      </section>

      {pending && (
        <div className="rounded border border-amber-400 bg-amber-50 p-4 text-sm">
          <p data-testid="reprocess-warning">
            ⚠️ "<b>{pending.kind === "server" ? pending.name : pending.file.name}</b>" já foi
            importado em <b>{pending.lastIngestedAt}</b> ({pending.rows} linhas).
            Reprocessar substituirá esses registros.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              className="rounded bg-amber-700 px-3 py-1 text-white"
              onClick={confirmReprocess}
            >
              Reprocessar (substituir {pending.rows} linhas)
            </button>
            <button
              className="rounded border px-3 py-1"
              onClick={() => setPending(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

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
                      className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-40"
                      disabled={phase !== "idle"}
                      onClick={() => onImportServer(f.name)}
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

      {phase !== "idle" && (
        <ProgressMonitor
          phase={phase === "upload" ? "upload" : "ingest"}
          upload={upload}
          job={job}
        />
      )}
    </div>
  );
}
