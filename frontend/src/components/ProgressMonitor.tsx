import type { ImportJob, UploadProgress } from "../api/client.js";

function elapsedSeconds(startedAt: string, end: string | null): number {
  const s = Date.parse(startedAt.replace(" ", "T"));
  const e = end ? Date.parse(end.replace(" ", "T")) : Date.now();
  const d = (e - s) / 1000;
  return Number.isFinite(d) && d >= 0 ? d : 0;
}

export function ProgressMonitor(props: {
  phase: "upload" | "ingest";
  upload: UploadProgress | null;
  job: ImportJob | null;
}) {
  if (props.phase === "upload" && props.upload) {
    const pct = props.upload.total > 0
      ? Math.round((props.upload.loaded / props.upload.total) * 100)
      : 0;
    return (
      <div className="rounded bg-white p-4 shadow text-sm space-y-2">
        <p className="font-semibold">Enviando arquivo… {pct}%</p>
        <div className="h-3 w-full overflow-hidden rounded bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="h-3 bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-slate-500">
          {(props.upload.loaded / 1_048_576).toFixed(1)} /
          {" "}{(props.upload.total / 1_048_576).toFixed(1)} MB
        </p>
      </div>
    );
  }

  const job = props.job;
  if (!job) return null;
  const secs = elapsedSeconds(job.startedAt, job.finishedAt);
  const rate = secs > 0 ? Math.round(job.rowsProcessed / secs) : 0;
  const done = job.status === "done";
  const failed = job.status === "failed";

  return (
    <div className="rounded bg-white p-4 shadow text-sm space-y-2">
      <p className="font-semibold">
        {done ? "Ingestão concluída" : failed ? "Ingestão falhou" : "Ingestão em andamento…"}
      </p>
      <div className="h-3 w-full overflow-hidden rounded bg-slate-200" role="progressbar" aria-label="progresso da ingestão">
        <div
          className={
            "h-3 " +
            (done ? "w-full bg-green-600"
              : failed ? "w-full bg-red-600"
              : "w-1/3 animate-pulse bg-blue-600")
          }
        />
      </div>
      <ul className="text-slate-700">
        <li>Arquivo: <b>{job.file}</b></li>
        <li>Linhas processadas: <b>{job.rowsProcessed}</b></li>
        <li>Linhas inseridas: <b>{job.rowsInserted}</b></li>
        <li>Erros: <b>{job.parseErrors}</b></li>
        <li>Tempo: {secs.toFixed(0)}s · {rate} linhas/s</li>
      </ul>
      {failed && job.error && <p className="text-red-600">Erro: {job.error}</p>}
    </div>
  );
}
