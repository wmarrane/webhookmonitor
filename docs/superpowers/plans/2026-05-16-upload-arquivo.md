# Upload de Arquivo + Monitor Visual de Ingestão — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir enviar um CSV do computador do usuário pelo navegador para ser ingerido no ClickHouse, e exibir um monitor visual de progresso (upload determinado + ingestão indeterminada com contadores ao vivo) na tela de Importação.

**Architecture:** Nova rota Fastify `POST /api/upload` (`@fastify/multipart`, streaming direto para disco em `UPLOAD_DIR` gravável, sem bufferizar) que reusa o pipeline de ingestão via um runner compartilhado `startIngestJob` (extraído de `routes/import.ts`, DRY). O frontend ganha `api.uploadFile` (XHR com progresso) e um componente `ProgressMonitor` usado na tela de Importação. Compose ganha volume RW `./uploads`.

**Tech Stack:** Fastify 5.8.5, `@fastify/multipart` 10.0.0, Node 22 streams (`node:stream/promises` pipeline), Vitest 4, React 19, XHR upload progress, Docker Compose. Dev-only: `form-data` 4.x para construir multipart nos testes de backend.

**Conventions:** Worktree `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\.claude\worktrees\monitor-integracao`, branch `worktree-monitor-integracao`. Absolute Windows paths. ESM NodeNext (relative imports `.js`). TDD: failing test → run red → minimal impl → run green → commit. Commits terminam com:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Rodar testes: `npm run test --workspace backend [-- pat]` / `npm run test --workspace frontend [-- pat]`. Build: `npm run build`.

---

## File Structure

```
backend/
  src/
    config.ts                 # + UPLOAD_DIR, MAX_UPLOAD_BYTES
    ingest/runJob.ts          # NOVO: startIngestJob (runner compartilhado)
    routes/import.ts          # refatora para usar startIngestJob
    routes/upload.ts          # NOVO: POST /api/upload (multipart streaming)
    index.ts                  # registra @fastify/multipart + registerUpload
  tests/
    config.test.ts            # NOVO
    upload.test.ts            # NOVO
frontend/
  src/
    api/client.ts             # + uploadFile(file,onProgress)
    components/ProgressMonitor.tsx   # NOVO
    pages/Import.tsx           # input file + ProgressMonitor
  src/api/client.test.tsx      # + caso uploadFile
  src/components/ProgressMonitor.test.tsx  # NOVO
  src/pages/Import.test.tsx    # atualiza p/ ProgressMonitor + upload
docker-compose.yml             # volume uploads + envs
.env.example                   # UPLOAD_DIR, MAX_UPLOAD_BYTES
.gitignore                     # uploads/*
uploads/.gitkeep               # NOVO
```

---

## Task 1: Config — UPLOAD_DIR e MAX_UPLOAD_BYTES

**Files:**
- Modify: `backend/src/config.ts`
- Create (test): `backend/tests/config.test.ts`

- [ ] **Step 1: Write the failing test** — `backend/tests/config.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  CLICKHOUSE_URL: "http://localhost:8123",
  CLICKHOUSE_USER: "u",
  CLICKHOUSE_PASSWORD: "",
};

describe("loadConfig — upload settings", () => {
  it("defaults UPLOAD_DIR=/uploads and MAX_UPLOAD_BYTES=0", () => {
    const c = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(c.UPLOAD_DIR).toBe("/uploads");
    expect(c.MAX_UPLOAD_BYTES).toBe(0);
  });

  it("reads overrides and coerces MAX_UPLOAD_BYTES to number", () => {
    const c = loadConfig({ ...base, UPLOAD_DIR: "/tmp/up", MAX_UPLOAD_BYTES: "1048576" } as NodeJS.ProcessEnv);
    expect(c.UPLOAD_DIR).toBe("/tmp/up");
    expect(c.MAX_UPLOAD_BYTES).toBe(1048576);
  });

  it("rejects negative MAX_UPLOAD_BYTES", () => {
    expect(() => loadConfig({ ...base, MAX_UPLOAD_BYTES: "-1" } as NodeJS.ProcessEnv)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace backend -- config`
Expected: FAIL — `UPLOAD_DIR` undefined / property missing.

- [ ] **Step 3: Minimal implementation** — edit `backend/src/config.ts`, add to the `z.object({...})` schema after the `LOG_LEVEL` line:

```ts
  LOG_LEVEL: z.string().default("info"),
  UPLOAD_DIR: z.string().min(1).default("/uploads"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().nonnegative().default(0),
```

(Replace the existing `LOG_LEVEL: z.string().default("info"),` line with the three lines above. Nothing else changes; `AppConfig`/`loadConfig` already derive from the schema.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace backend -- config`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/config.ts backend/tests/config.test.ts
git commit -m "feat(api): UPLOAD_DIR and MAX_UPLOAD_BYTES config" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Extrair runner de ingestão compartilhado (`startIngestJob`)

DRY: `routes/import.ts` tem o IIFE de ingestão inline. Extrair para reuso pela rota de upload, mantendo os testes de import verdes.

**Files:**
- Create: `backend/src/ingest/runJob.ts`
- Modify: `backend/src/routes/import.ts`
- Test: `backend/tests/import.test.ts` (deve continuar passando sem alteração)

- [ ] **Step 1: Create `backend/src/ingest/runJob.ts`**

```ts
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { ingestCsv } from "./ingestService.js";
import type { JobStore } from "./jobStore.js";

export interface IngestJobRepo {
  deleteByFileName: (file: string) => Promise<void>;
  insertRows: (rows: unknown[]) => Promise<void>;
}

export interface StartIngestJobOptions {
  jobs: JobStore;
  jobId: string;
  repo: IngestJobRepo;
  filePath: string;
  batchSize: number;
}

/**
 * Fire-and-forget: roda o ingest de filePath e atualiza o job.
 * source_file no ClickHouse é basename(filePath) (igual ao ingestCsv),
 * então deleteByFileName usa o mesmo basename para o "replace por arquivo".
 */
export function startIngestJob(opts: StartIngestJobOptions): void {
  const sourceName = basename(opts.filePath);
  void (async () => {
    try {
      await opts.repo.deleteByFileName(sourceName);
      let firstInsertError: string | null = null;
      const result = await ingestCsv({
        filePath: opts.filePath,
        ingestBatch: randomUUID(),
        batchSize: opts.batchSize,
        insert: async (rows) => {
          await opts.repo.insertRows(rows);
        },
        onProgress: (p) => opts.jobs.update(opts.jobId, p),
        onError: (err) => {
          if (firstInsertError === null) {
            firstInsertError = err instanceof Error ? err.message : String(err);
          }
        },
      });
      opts.jobs.update(opts.jobId, result);
      if (result.rowsInserted === 0 && result.rowsProcessed > 0) {
        opts.jobs.finish(opts.jobId, "failed", firstInsertError ?? "no rows were inserted");
      } else {
        opts.jobs.finish(opts.jobId, "done");
      }
    } catch (err) {
      opts.jobs.finish(
        opts.jobId,
        "failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  })();
}
```

- [ ] **Step 2: Refactor `backend/src/routes/import.ts`** — substituir o corpo do `void (async () => { ... })();` (todo o bloco a partir de `const job = deps.jobs.create(safe);`) por:

```ts
    const job = deps.jobs.create(safe);
    reply.code(202).send({ jobId: job.id });

    startIngestJob({
      jobs: deps.jobs,
      jobId: job.id,
      repo: deps.repo,
      filePath: full,
      batchSize: deps.cfg.INGEST_BATCH_SIZE,
    });
```

E no topo do arquivo trocar o import de `ingestCsv`/`randomUUID` por:

```ts
import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { JobStore } from "../ingest/jobStore.js";
import { startIngestJob } from "../ingest/runJob.js";
```

(Remova `randomUUID` e `ingestCsv` não usados. Mantenha `RepoLike`/`Deps` como estão — `RepoLike` é compatível com `IngestJobRepo`.)

- [ ] **Step 3: Run import tests (must stay green)**

Run: `npm run test --workspace backend -- import`
Expected: PASS (2 tests) — comportamento idêntico (202 + job chega a `done`, `../secrets.txt` → 400).

- [ ] **Step 4: Typecheck**

Run: `npm run build --workspace backend`
Expected: compila limpo.

- [ ] **Step 5: Commit**

```bash
git add backend/src/ingest/runJob.ts backend/src/routes/import.ts
git commit -m "refactor(api): extract shared startIngestJob runner" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Rota de upload (`POST /api/upload`) com streaming

**Files:**
- Modify: `backend/package.json` (deps: `@fastify/multipart` 10.0.0; devDeps: `form-data` 4.0.1)
- Create: `backend/src/routes/upload.ts`
- Create (test): `backend/tests/upload.test.ts`

- [ ] **Step 1: Install deps**

Edit `backend/package.json`: em `"dependencies"` adicionar `"@fastify/multipart": "10.0.0"`; em `"devDependencies"` adicionar `"form-data": "4.0.1"`. Então, da raiz do worktree:

Run: `npm install`
Expected: instala sem erro; `@fastify/multipart` e `form-data` resolvidos.

- [ ] **Step 2: Write the failing test** — `backend/tests/upload.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import FormData from "form-data";
import { registerUpload } from "../src/routes/upload.js";
import { JobStore } from "../src/ingest/jobStore.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "uploads-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function fakeRepo() {
  const inserted: unknown[] = [];
  return { inserted, deleteByFileName: async () => {}, insertRows: async (r: unknown[]) => { inserted.push(...r); } };
}

const CSV =
  "ID interno,Data,Hora,Nome,Título,Tipo,Tipo de script,Detalhes\n" +
  '3262308,15/05/2026,1:06,[CCC] MSG,nr,Depurar,Evento de usuário,"{""id"":""360738"",""type"":""invoice"",""fields"":{""custbody_nst_integra_id_"":""38967664""}}"\n';

async function build(maxBytes = 0) {
  const app = Fastify();
  await app.register(multipart);
  const jobs = new JobStore();
  const repo = fakeRepo();
  registerUpload(app, {
    cfg: { UPLOAD_DIR: dir, INGEST_BATCH_SIZE: 100, MAX_UPLOAD_BYTES: maxBytes } as never,
    repo: repo as never,
    jobs,
  });
  return { app, jobs, repo };
}

function form(filename: string, content: string) {
  const f = new FormData();
  f.append("file", Buffer.from(content), { filename, contentType: "text/csv" });
  return f;
}

describe("POST /api/upload", () => {
  it("streams a CSV to UPLOAD_DIR and ingests it (job done)", async () => {
    const { app, jobs, repo } = await build();
    const f = form("dados.csv", CSV);
    const res = await app.inject({ method: "POST", url: "/api/upload", payload: f, headers: f.getHeaders() });
    expect(res.statusCode).toBe(202);
    const { jobId } = res.json() as { jobId: string };
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);

    let st = "";
    for (let i = 0; i < 50; i++) {
      const r = await app.inject({ method: "GET", url: `/api/import/${jobId}` });
      st = (r.json() as { status: string }).status;
      if (st !== "running") break;
      await new Promise((x) => setTimeout(x, 20));
    }
    // a rota de status vem do registerImport; aqui validamos via jobs diretamente:
    const job = jobs.get(jobId)!;
    expect(["done", "failed"]).toContain(job.status);
    expect(job.status).toBe("done");
    expect(repo.inserted.length).toBe(1);
    expect(readdirSync(dir).length).toBe(1); // arquivo salvo
    await app.close();
  });

  it("rejects non-csv with 400", async () => {
    const { app } = await build();
    const f = form("nota.txt", "x");
    const res = await app.inject({ method: "POST", url: "/api/upload", payload: f, headers: f.getHeaders() });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("rejects when no file part is present", async () => {
    const { app } = await build();
    const f = new FormData();
    f.append("notafile", "x");
    const res = await app.inject({ method: "POST", url: "/api/upload", payload: f, headers: f.getHeaders() });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("enforces MAX_UPLOAD_BYTES and removes the partial file (413)", async () => {
    const { app } = await build(8); // 8 bytes limit
    const f = form("grande.csv", CSV); // bem maior que 8
    const res = await app.inject({ method: "POST", url: "/api/upload", payload: f, headers: f.getHeaders() });
    expect(res.statusCode).toBe(413);
    expect(readdirSync(dir).length).toBe(0); // parcial removido
    await app.close();
  });

  it("sanitizes path-traversal filenames (stays inside UPLOAD_DIR)", async () => {
    const { app } = await build();
    const f = form("../../evil.csv", CSV);
    const res = await app.inject({ method: "POST", url: "/api/upload", payload: f, headers: f.getHeaders() });
    expect(res.statusCode).toBe(202);
    const names = readdirSync(dir);
    expect(names.length).toBe(1);
    expect(names[0].includes("..")).toBe(false);
    expect(names[0].endsWith(".csv")).toBe(true);
    await app.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace backend -- upload`
Expected: FAIL — `../src/routes/upload.js` não encontrado.

- [ ] **Step 4: Minimal implementation** — `backend/src/routes/upload.ts`

```ts
import { basename, extname, join } from "node:path";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { JobStore } from "../ingest/jobStore.js";
import { startIngestJob, type IngestJobRepo } from "../ingest/runJob.js";

interface Deps {
  cfg: Pick<AppConfig, "UPLOAD_DIR" | "INGEST_BATCH_SIZE" | "MAX_UPLOAD_BYTES">;
  repo: IngestJobRepo;
  jobs: JobStore;
}

export function registerUpload(app: FastifyInstance, deps: Deps): void {
  app.post("/api/upload", async (req, reply) => {
    const limits =
      deps.cfg.MAX_UPLOAD_BYTES > 0
        ? { limits: { fileSize: deps.cfg.MAX_UPLOAD_BYTES } }
        : {};
    const part = await req.file({ ...limits, throwFileSizeLimit: false });

    if (!part || !part.filename) {
      return reply.code(400).send({ error: "bad_request", message: "no file part" });
    }
    const original = basename(part.filename);
    if (!original.toLowerCase().endsWith(".csv")) {
      // drena o stream para não travar a conexão
      part.file.resume();
      return reply.code(400).send({ error: "bad_request", message: "only .csv files are accepted" });
    }

    const stem = basename(original, extname(original)).replace(/[^A-Za-z0-9._-]/g, "_");
    const unique = `${stem}-${Date.now()}.csv`;
    const dest = join(deps.cfg.UPLOAD_DIR, unique);

    try {
      await pipeline(part.file, createWriteStream(dest));
    } catch (err) {
      await unlink(dest).catch(() => {});
      throw err;
    }

    if (part.file.truncated) {
      await unlink(dest).catch(() => {});
      return reply.code(413).send({ error: "too_large", message: "file exceeds MAX_UPLOAD_BYTES" });
    }

    const job = deps.jobs.create(unique);
    reply.code(202).send({ jobId: job.id });

    startIngestJob({
      jobs: deps.jobs,
      jobId: job.id,
      repo: deps.repo,
      filePath: dest,
      batchSize: deps.cfg.INGEST_BATCH_SIZE,
    });
  });

  // espelha o status como em registerImport (para o teste/uso isolado)
  app.get<{ Params: { id: string } }>("/api/import/:id", async (req, reply) => {
    const job = deps.jobs.get(req.params.id);
    if (!job) return reply.code(404).send({ error: "not_found", message: "job not found" });
    return job;
  });
}
```

> Nota de integração: `registerImport` já define `GET /api/import/:id`. No `index.ts` (Task 4) ambos compartilham o **mesmo `JobStore`**, e Fastify lançaria erro de rota duplicada se as duas registrarem `GET /api/import/:id`. Portanto: o `GET /api/import/:id` acima existe para o teste isolado de upload; no `index.ts` registramos `registerImport` (que já provê o status) e o upload usa o status dela. Para evitar a duplicação em produção, a Task 4 registra `registerUpload` com uma flag para **não** registrar a rota de status. Implementar `registerUpload(app, deps, opts?: { statusRoute?: boolean })` com `statusRoute` default `true`; quando `false`, não registra o `GET /api/import/:id`. Ajuste o final de `upload.ts`:

```ts
}

export function registerUpload(
  app: FastifyInstance,
  deps: Deps,
  opts: { statusRoute?: boolean } = {},
): void {
  // ...todo o POST /api/upload acima permanece igual...

  if (opts.statusRoute !== false) {
    app.get<{ Params: { id: string } }>("/api/import/:id", async (req, reply) => {
      const job = deps.jobs.get(req.params.id);
      if (!job) return reply.code(404).send({ error: "not_found", message: "job not found" });
      return job;
    });
  }
}
```

(Reescreva `upload.ts` com a assinatura final `registerUpload(app, deps, opts = {})` envolvendo o `GET` no `if (opts.statusRoute !== false)`. O teste da Task 3 chama `registerUpload(app, {...})` sem opts → `statusRoute` default true → status disponível no teste.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace backend -- upload`
Expected: PASS (5 tests).

- [ ] **Step 6: Full backend suite + build**

Run: `npm run test --workspace backend`
Expected: todas as suítes verdes (config, csv, jobStore, ingestService, health, files, import, requests, upload).
Run: `npm run build --workspace backend`
Expected: compila limpo.

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/src/routes/upload.ts backend/tests/upload.test.ts ../../package-lock.json package-lock.json
git commit -m "feat(api): streaming file upload route /api/upload" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(O `package-lock.json` fica na raiz do worktree; ajuste o `git add` para o caminho correto: `git add backend/package.json backend/src/routes/upload.ts backend/tests/upload.test.ts package-lock.json` executando da raiz do worktree.)

---

## Task 4: Wire upload no servidor (`index.ts`)

**Files:**
- Modify: `backend/src/index.ts`

Sem teste unitário (bootstrap); validado por build + smoke posterior.

- [ ] **Step 1: Edit `backend/src/index.ts`**

Adicionar import no topo (após os imports de rotas existentes):

```ts
import multipart from "@fastify/multipart";
import { registerUpload } from "./routes/upload.js";
```

Dentro de `buildServer({ ... registerExtra: (a) => { ... } })`, o `registerExtra` deve ficar:

```ts
  registerExtra: (a) => {
    a.register(multipart);
    registerFiles(a, cfg);
    registerImport(a, { cfg, repo, jobs });
    registerRequests(a, repo);
    registerTransactions(a, repo);
    registerUpload(a, { cfg, repo, jobs }, { statusRoute: false });
  },
```

(`registerImport` já provê `GET /api/import/:id`; `registerUpload` com `statusRoute:false` evita rota duplicada. `cfg` satisfaz `Pick<AppConfig,"UPLOAD_DIR"|"INGEST_BATCH_SIZE"|"MAX_UPLOAD_BYTES">`. `a.register(multipart)` antes das rotas que usam `req.file()`.)

- [ ] **Step 2: Build**

Run: `npm run build --workspace backend`
Expected: compila limpo (sem variáveis não usadas; `multipart`/`registerUpload` usados).

- [ ] **Step 3: Full backend suite**

Run: `npm run test --workspace backend`
Expected: tudo verde (índice não é testado, mas deve compilar).

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(api): register multipart + upload route in bootstrap" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Cliente `uploadFile` (XHR com progresso)

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify (test): `frontend/src/api/client.test.tsx`

- [ ] **Step 1: Write the failing test** — adicionar ao final do `describe("api client", ...)` em `frontend/src/api/client.test.tsx`:

```ts
  it("uploadFile posts multipart and resolves jobId, reporting progress", async () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const xhrMock = {
      upload: { addEventListener: (k: string, cb: (e: unknown) => void) => { listeners["up_" + k] = cb; } },
      addEventListener: (k: string, cb: (e: unknown) => void) => { listeners[k] = cb; },
      open: vi.fn(),
      send: vi.fn(function (this: unknown) {
        listeners["up_progress"]({ lengthComputable: true, loaded: 5, total: 10 });
        Object.assign(xhrMock, { status: 202, responseText: JSON.stringify({ jobId: "job-9" }) });
        listeners["load"]({});
      }),
      setRequestHeader: vi.fn(),
      status: 0,
      responseText: "",
    };
    vi.stubGlobal("XMLHttpRequest", function () { return xhrMock; } as unknown);

    const seen: number[] = [];
    const file = new File([new Uint8Array(10)], "x.csv", { type: "text/csv" });
    const jobId = await api.uploadFile(file, (p) => seen.push(p.loaded / p.total));
    expect(jobId).toBe("job-9");
    expect(seen).toContain(0.5);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace frontend -- client`
Expected: FAIL — `api.uploadFile` is not a function.

- [ ] **Step 3: Minimal implementation** — em `frontend/src/api/client.ts` adicionar antes de `export const api = {`:

```ts
export interface UploadProgress { loaded: number; total: number; }

function uploadFile(
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/api/upload`);
    xhr.upload.addEventListener("progress", (e: unknown) => {
      const ev = e as { lengthComputable: boolean; loaded: number; total: number };
      if (ev.lengthComputable && onProgress) onProgress({ loaded: ev.loaded, total: ev.total });
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve((JSON.parse(xhr.responseText) as { jobId: string }).jobId);
        } catch {
          reject(new Error("invalid upload response"));
        }
      } else {
        reject(new Error(`API ${xhr.status}: /api/upload`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("upload network error")));
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}
```

E no objeto `export const api = {` adicionar a entrada:

```ts
  uploadFile,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace frontend -- client`
Expected: PASS (3 tests no arquivo).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.test.tsx
git commit -m "feat(web): uploadFile XHR client with progress" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Componente `ProgressMonitor`

**Files:**
- Create: `frontend/src/components/ProgressMonitor.tsx`
- Create (test): `frontend/src/components/ProgressMonitor.test.tsx`

Props: fase de upload (determinada) e fase de ingestão (indeterminada + contadores). Sem `%` falso na ingestão.

- [ ] **Step 1: Write the failing test** — `frontend/src/components/ProgressMonitor.test.tsx`

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressMonitor } from "./ProgressMonitor.js";
import type { ImportJob } from "../api/client.js";

const job = (over: Partial<ImportJob> = {}): ImportJob => ({
  id: "j", file: "x.csv", status: "running",
  rowsProcessed: 1200, rowsInserted: 1190, parseErrors: 10,
  error: null, startedAt: "2026-05-16 10:00:00", finishedAt: null, ...over,
});

describe("ProgressMonitor", () => {
  it("upload phase shows a determinate percentage", () => {
    render(<ProgressMonitor phase="upload" upload={{ loaded: 5, total: 10 }} job={null} />);
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  it("ingest phase shows live counters and NO percentage", () => {
    render(<ProgressMonitor phase="ingest" upload={null} job={job()} />);
    expect(screen.getByText(/1200/)).toBeInTheDocument();   // processadas
    expect(screen.getByText(/1190/)).toBeInTheDocument();   // inseridas
    expect(screen.getByText(/10/)).toBeInTheDocument();     // erros
    expect(screen.queryByText(/%/)).toBeNull();             // sem % falso
    expect(screen.getByText(/processa/i)).toBeInTheDocument();
  });

  it("done shows success summary", () => {
    render(<ProgressMonitor phase="ingest" upload={null} job={job({ status: "done", finishedAt: "2026-05-16 10:01:00" })} />);
    expect(screen.getByText(/conclu/i)).toBeInTheDocument();
  });

  it("failed shows the error", () => {
    render(<ProgressMonitor phase="ingest" upload={null} job={job({ status: "failed", error: "boom" })} />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace frontend -- ProgressMonitor`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Minimal implementation** — `frontend/src/components/ProgressMonitor.tsx`

```tsx
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
        <div className="h-3 w-full overflow-hidden rounded bg-slate-200">
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
      <div className="h-3 w-full overflow-hidden rounded bg-slate-200">
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace frontend -- ProgressMonitor`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ProgressMonitor.tsx frontend/src/components/ProgressMonitor.test.tsx
git commit -m "feat(web): ProgressMonitor component" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Integrar upload + ProgressMonitor na tela Import

**Files:**
- Modify: `frontend/src/pages/Import.tsx`
- Modify (test): `frontend/src/pages/Import.test.tsx`

- [ ] **Step 1: Update the test** — substituir o conteúdo de `frontend/src/pages/Import.test.tsx` por (mantém o caso existente de lista + adiciona upload; assertions fortes, sem enfraquecer):

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Import } from "./Import.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

describe("Import", () => {
  it("lists files, starts import, shows ProgressMonitor until done", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ name: "sample.csv", size: 10, modified: "2026-05-16T00:00:00Z" }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "job-1" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", file: "sample.csv", status: "done", rowsProcessed: 3, rowsInserted: 3, parseErrors: 0, error: null, startedAt: "2026-05-16 10:00:00", finishedAt: "2026-05-16 10:00:01" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Import />);
    await waitFor(() => expect(screen.getByText("sample.csv")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /importar/i }));
    await waitFor(() => expect(screen.getByText(/Ingest[aã]o conclu/i)).toBeInTheDocument(), { timeout: 5000 });
  });

  it("uploads a chosen file then tracks ingestion", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-7", file: "u.csv", status: "done", rowsProcessed: 2, rowsInserted: 2, parseErrors: 0, error: null, startedAt: "2026-05-16 10:00:00", finishedAt: "2026-05-16 10:00:01" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const upSpy = vi.spyOn(api, "uploadFile").mockResolvedValue("job-7");

    render(<Import />);
    await waitFor(() => expect(screen.getByLabelText(/arquivo do meu computador/i)).toBeInTheDocument());
    const input = screen.getByLabelText(/arquivo do meu computador/i) as HTMLInputElement;
    const file = new File(["a,b\n1,2\n"], "u.csv", { type: "text/csv" });
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole("button", { name: /enviar/i }));
    expect(upSpy).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/Ingest[aã]o conclu/i)).toBeInTheDocument(), { timeout: 5000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace frontend -- Import`
Expected: FAIL — sem input "arquivo do meu computador" / sem texto "Ingestão concluída".

- [ ] **Step 3: Implementation** — substituir o conteúdo de `frontend/src/pages/Import.tsx` por:

```tsx
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
          disabled={!picked}
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
```

> Observação: o `AsyncState` mostra `error` global. Como erros de upload/ingest também vão para `setError`, isso é consistente com o comportamento atual da página (o painel some e o erro aparece). Mantido por simplicidade/consistência.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace frontend -- Import`
Expected: PASS (2 tests).

- [ ] **Step 5: Full frontend suite + build**

Run: `npm run test --workspace frontend`
Expected: tudo verde (client, AsyncState, Dashboard, Requests, Import, ProgressMonitor).
Run: `npm run build --workspace frontend`
Expected: `tsc -b && vite build` limpo (aviso de chunk >500kB é aceitável).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Import.tsx frontend/src/pages/Import.test.tsx
git commit -m "feat(web): file upload section + ProgressMonitor on Import page" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Infra — volume uploads, env, gitignore

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `.gitignore`
- Create: `uploads/.gitkeep`

- [ ] **Step 1: Edit `docker-compose.yml`** — no serviço `monitor-api`, no bloco `environment:` adicionar após `LOG_LEVEL: ${LOG_LEVEL}`:

```yaml
      UPLOAD_DIR: /uploads
      MAX_UPLOAD_BYTES: ${MAX_UPLOAD_BYTES}
```

E no bloco `volumes:` do `monitor-api`, adicionar após `- ./cargas:/cargas:ro`:

```yaml
      - ./uploads:/uploads
```

(Volume gravável, sem `:ro`. Não alterar healthcheck/ports/web.)

- [ ] **Step 2: Edit `.env.example`** — adicionar após a linha `LOG_LEVEL=info`:

```
# Upload (browser → server). MAX_UPLOAD_BYTES=0 = sem limite.
UPLOAD_DIR=/uploads
MAX_UPLOAD_BYTES=0
```

- [ ] **Step 3: Edit `.gitignore`** — adicionar ao final:

```
# Uploaded files
uploads/*
!uploads/.gitkeep
```

- [ ] **Step 4: Create `uploads/.gitkeep`** (arquivo vazio).

- [ ] **Step 5: Validate compose YAML**

Run: `npm run build` (raiz) — garante que nada quebrou nos workspaces.
Expected: backend + frontend build limpos.
(Se `docker` estiver disponível: `docker compose config` deve listar o volume `./uploads:/uploads` e as envs novas. Sem docker local, validação visual do YAML — indentação 2 espaços, sem tabs.)

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example .gitignore uploads/.gitkeep
git commit -m "chore: uploads volume + env (browser upload)" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Verificação final + merge + deploy

**Files:** nenhum (operacional).

- [ ] **Step 1: Suíte completa + build (raiz)**

Run: `npm test`
Expected: backend (config + 5 csv/ingest + jobStore + health + files + import + requests + upload) e frontend (client + AsyncState + Dashboard + Requests + Import + ProgressMonitor) — todos verdes, 0 skips.
Run: `npm run build`
Expected: ambos limpos.

- [ ] **Step 2: Merge para `main` e push**

Da raiz do worktree:

```bash
git push origin HEAD:main
```

Expected: push ok para `https://github.com/wmarrane/webhookmonitor` (branch `main`). Capturar o range de commits.

- [ ] **Step 3: Redeploy no servidor `192.168.56.113`**

Via SSH (padrão já usado: `SSH_ASKPASS=/tmp/askpass.sh SSH_ASKPASS_REQUIRE=force ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no wagner@192.168.56.113`), executar no servidor:

```bash
cd ~/webhookmonitor && \
git fetch -q origin main && git reset -q --hard origin/main && \
mkdir -p uploads && \
grep -q '^MAX_UPLOAD_BYTES=' .env || printf '\nUPLOAD_DIR=/uploads\nMAX_UPLOAD_BYTES=0\n' >> .env && \
echo 123 | sudo -S -p "" docker compose up -d --build
```

Aguardar `monitor-api` `healthy` e `monitor-web` `Up` (loop server-side: inspecionar `.State.Health.Status` até `healthy`, timeout ~5min).
Expected: `curl http://127.0.0.1:8091/api/health` → `{"status":"ok","clickhouse":true}`; `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:8090/` → `200`.

- [ ] **Step 4: Smoke do upload (servidor)**

No servidor, criar um CSV pequeno e enviar via API:

```bash
printf 'ID interno,Data,Hora,Nome,Título,Tipo,Tipo de script,Detalhes\n9001,15/05/2026,1:06,X,nr,Depurar,Evento de usuário,"{""id"":""9001"",""type"":""invoice"",""fields"":{""custbody_nst_integra_id_"":""777""}}"\n' > /tmp/smoke.csv
curl -s -F "file=@/tmp/smoke.csv;type=text/csv" http://127.0.0.1:8091/api/upload
```

Expected: resposta `202 {"jobId":"..."}`; em seguida `curl http://127.0.0.1:8091/api/import/<jobId>` mostra `status:"done"` com `rowsInserted` ≥ 1; `curl 'http://127.0.0.1:8091/api/requests?q=9001'` retorna o registro. Reportar resultado real (sem fabricar).

- [ ] **Step 5: Verificação externa**

Da máquina de dev: `curl http://192.168.56.113:8091/api/health` e abrir `http://192.168.56.113:8090` (aba Importação deve ter a seção "Enviar arquivo do meu computador"). Reportar status final.

---

## Self-Review Notes (resolved)

- **Spec coverage:** upload streaming → `/uploads` (Task 3, 8); reuso do pipeline via `startIngestJob` (Task 2, 3); config `UPLOAD_DIR`/`MAX_UPLOAD_BYTES` sem limite default (Task 1, 8); cliente `uploadFile` XHR com progresso (Task 5); `ProgressMonitor` — upload determinado, ingestão indeterminada + contadores, estados done/failed (Task 6); integração na tela Import substituindo painel textual (Task 7); compose volume RW + env + gitignore (Task 8); erros 400/413/parcial removido/path-traversal (Task 3 testes); deploy real + smoke (Task 9). Página dedicada de Monitoramento e SSE permanecem fora de escopo (spec §6).
- **Placeholder scan:** nenhum TBD/TODO; todo código presente. A nota sobre `statusRoute` em Task 3 instrui a assinatura final concreta (`registerUpload(app, deps, opts={})`) — não é placeholder.
- **Type consistency:** `IngestJobRepo` (runJob) ⊇ `RepoLike` (import) — compatível; `startIngestJob` deriva `source_file` via `basename(filePath)` igual ao `ingestCsv` existente; `UploadProgress`/`ImportJob` usados consistentemente entre `client.ts`, `ProgressMonitor.tsx` e `Import.tsx`; `registerUpload(app, deps, opts?)` chamado com `{statusRoute:false}` só no `index.ts` (evita rota `GET /api/import/:id` duplicada com `registerImport`).
- **Risco/observação:** `@fastify/multipart` 10.0.0 com Fastify 5 — se a API `req.file({throwFileSizeLimit,limits})` divergir, ajustar minimamente preservando o comportamento testado (202/400/413/parcial removido) e reportar.
