import { useEffect, useRef, useState } from "react";
import { api, type FileInfo, type ImportJob, type UploadProgress } from "../api/client.js";
import { AsyncState } from "../components/AsyncState.js";
import { ProgressMonitor } from "../components/ProgressMonitor.js";

export function Import() {
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [phase, setPhase] = useState<"idle" | "upload" | "ingest">("idle");
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [picked, setPicked] = useState<File | null>(null);
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

  const startServerFile = async (file: string) => {
    setJob(null); setError(null); setUpload(null);
    try {
      const { jobId } = await api.startImport(file);
      poll(jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const sendUpload = async () => {
    if (!picked) return;
    setJob(null); setError(null); setUpload({ loaded: 0, total: picked.size });
    setPhase("upload");
    try {
      const jobId = await api.uploadFile(picked, (p) => setUpload(p));
      poll(jobId);
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
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
          disabled={!picked || phase !== "idle"}
          onClick={sendUpload}
        >
          Enviar
        </button>
      </section>

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
                      onClick={() => startServerFile(f.name)}
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
