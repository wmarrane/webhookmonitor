# Controle de Importação Anti-Duplicidade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedir duplicação no ClickHouse: `source_file` passa a ser o nome ORIGINAL do arquivo; importar/enviar um arquivo já importado retorna 409 a menos que `replace=true`, caso em que substitui (delete por nome + reinsere); a UI detecta antes, avisa e só reprocessa ao confirmar.

**Architecture:** Threading de um `sourceName` explícito (nome original) por `startIngestJob`→`ingestCsv`→`mapRow` (substitui `basename(filePath)`). Novo `RequestsRepo.fileStats(name)` + endpoint `GET /api/imports/exists`. `POST /api/import` e `POST /api/upload` aplicam a regra 409/replace. Frontend faz pré-checagem e fluxo de confirmação.

**Tech Stack:** Fastify 5, @clickhouse/client, Vitest 4 (backend node / frontend jsdom singleFork), React 19, XHR upload. Branch `master` no repo raiz `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor` (HEAD `1d68409`). ESM NodeNext (`.js` nos imports relativos). Commits terminam com:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Tests: `npm run test --workspace backend [-- pat]` / `npm run test --workspace frontend [-- pat]`. Build: `npm run build`. Caminhos sempre absolutos Windows.

---

## File Structure

```
backend/src/ingest/runJob.ts          # + sourceName em StartIngestJobOptions; usa sourceName p/ delete+ingest
backend/src/ingest/ingestService.ts   # + sourceName em IngestOptions; mapRow usa sourceName (não basename)
backend/src/ingest/runJob.ts          # IngestJobRepo += fileStats
backend/src/repo/requestsRepo.ts      # + buildFileStatsQuery (puro) + fileStats()
backend/src/routes/imports.ts         # NOVO: GET /api/imports/exists
backend/src/routes/import.ts          # + replace/409; sourceName=safe
backend/src/routes/upload.ts          # + replace(query)/409+unlink; sourceName=original
backend/src/index.ts                  # registra registerImportsExists
frontend/src/api/client.ts            # + importExists(); startImport(file,replace); uploadFile(file,onProgress,replace)
frontend/src/pages/Import.tsx         # pré-check + aviso + confirmar(replace)
backend/tests/*                       # whereClause-style + rotas; ajustar ingestService.test.ts
frontend/src/**/*.test.tsx            # client + Import fluxo de confirmação
```

---

## Task 1: `sourceName` explícito no pipeline de ingestão

**Files:**
- Modify: `backend/src/ingest/ingestService.ts`
- Modify: `backend/src/ingest/runJob.ts`
- Modify (test): `backend/tests/ingestService.test.ts`

- [ ] **Step 1: Atualizar o teste de ingestService para o novo contrato (RED)**

Abra `backend/tests/ingestService.test.ts`. Para CADA chamada `ingestCsv({ ... })`, adicione a propriedade `sourceName: "sample.csv"` ao objeto de opções (mesmo valor que o teste hoje espera em `source_file`, que era `basename(filePath)` = `"sample.csv"` para o fixture). Se houver asserção sobre `source_file` (ex.: `expect(rows[0].source_file).toBe("sample.csv")`), mantenha o valor `"sample.csv"` (inalterado — agora vem de `sourceName` em vez de `basename`). Não enfraqueça nenhuma asserção.

Run: `npm run test --workspace backend -- ingestService`
Expected: FAIL — `ingestCsv` ainda usa `basename(opts.filePath)` e `IngestOptions` não tem `sourceName` (erro de tipo no teste OU asserção quebrada se o fixture tiver outro basename). Se por acaso passar, é porque basename==sourceName; então adicione um caso explícito: copie o fixture lógico chamando `ingestCsv` com `filePath` apontando para `sample.csv` mas `sourceName: "ORIGINAL.csv"` e asserte `expect(batches.flat()[0].source_file).toBe("ORIGINAL.csv")` — isso DEVE falhar antes da implementação.

- [ ] **Step 2: Implementar `sourceName` em `ingestService.ts`**

Em `backend/src/ingest/ingestService.ts`:
- Adicionar `sourceName: string;` à interface `IngestOptions` (após `batchSize`).
- Remover o uso de `basename`: trocar a linha
  `mapRow(record, opts.ingestBatch, ingestedAt, basename(opts.filePath))`
  por
  `mapRow(record, opts.ingestBatch, ingestedAt, opts.sourceName)`.
- Remover o `import { basename } from "node:path";` (não mais usado).

- [ ] **Step 3: Implementar `sourceName` em `runJob.ts`**

Em `backend/src/ingest/runJob.ts`:
- Adicionar `sourceName: string;` à interface `StartIngestJobOptions` (após `filePath`).
- Remover `const sourceName = basename(opts.filePath);` e o `import { basename } from "node:path";`.
- Usar `opts.sourceName`: `await opts.repo.deleteByFileName(opts.sourceName);` e passar `sourceName: opts.sourceName` no objeto de `ingestCsv({...})`.
- Atualizar o comentário JSDoc para: `/** Fire-and-forget: ingere filePath, grava source_file = sourceName, e deleteByFileName(sourceName) faz o "replace por arquivo". */`

- [ ] **Step 4: Ajustar chamadas existentes para compilar**

`backend/src/routes/import.ts`: na chamada `startIngestJob({...})` adicionar `sourceName: safe,` (junto de `filePath: full`).
`backend/src/routes/upload.ts`: na chamada `startIngestJob({...})` adicionar `sourceName: original,` (junto de `filePath: dest`).

- [ ] **Step 5: Verde + suíte + build**

Run: `npm run test --workspace backend -- ingestService` → PASS.
Run: `npm run test --workspace backend` → todas verdes (config, csv×3, jobStore, ingestService, health, files, import, requests, upload, whereClause), 0 skips. Se `import`/`upload` quebrarem por causa do `sourceName` agora obrigatório, é só compilação das chamadas (Step 4) — não enfraqueça testes.
Run: `npm run build --workspace backend` → limpo.

- [ ] **Step 6: Commit**

```
git add backend/src/ingest/ingestService.ts backend/src/ingest/runJob.ts backend/src/routes/import.ts backend/src/routes/upload.ts backend/tests/ingestService.test.ts
git commit -m "feat(api): explicit sourceName threaded into ingest (source_file = original name)" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `RequestsRepo.fileStats` + query pura testável

**Files:**
- Modify: `backend/src/repo/requestsRepo.ts`
- Create (test): `backend/tests/fileStats.test.ts`

- [ ] **Step 1: Teste RED** — `backend/tests/fileStats.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFileStatsQuery } from "../src/repo/requestsRepo.js";

describe("buildFileStatsQuery", () => {
  it("builds a parameterized count+max(ingested_at) query for a source_file", () => {
    const q = buildFileStatsQuery("monitor", "Consultaderequestsresultados635.csv");
    expect(q.query).toContain("FROM `monitor`.requests");
    expect(q.query).toContain("count() AS rows");
    expect(q.query).toContain("toString(max(ingested_at)) AS lastIngestedAt");
    expect(q.query).toContain("WHERE source_file = {file:String}");
    expect(q.params).toEqual({ file: "Consultaderequestsresultados635.csv" });
  });
});
```

Run: `npm run test --workspace backend -- fileStats` → FAIL (`buildFileStatsQuery` não exportado).

- [ ] **Step 2: Implementar em `backend/src/repo/requestsRepo.ts`**

Adicionar função exportada de nível de módulo (perto de `buildWhereClause`):

```ts
export function buildFileStatsQuery(
  db: string,
  file: string,
): { query: string; params: Record<string, unknown> } {
  return {
    query: `SELECT count() AS rows, toString(max(ingested_at)) AS lastIngestedAt FROM \`${db}\`.requests WHERE source_file = {file:String}`,
    params: { file },
  };
}
```

Adicionar método à classe `RequestsRepo`:

```ts
  async fileStats(file: string): Promise<{ rows: number; lastIngestedAt: string }> {
    const { query, params } = buildFileStatsQuery(this.db, file);
    const res = await this.client.query({ query, query_params: params, format: "JSON" });
    const data = (await res.json()).data as { rows: string; lastIngestedAt: string }[];
    const first = data[0];
    const rows = Number(first?.rows ?? 0);
    return { rows, lastIngestedAt: rows > 0 ? (first?.lastIngestedAt ?? "") : "" };
  }
```

- [ ] **Step 3: Estender `IngestJobRepo`** em `backend/src/ingest/runJob.ts` (interface) adicionando:

```ts
  fileStats: (file: string) => Promise<{ rows: number; lastIngestedAt: string }>;
```

(`RequestsRepo` já satisfaz isso após Step 2. `startIngestJob` não usa `fileStats`; só estende o contrato para as rotas.)

- [ ] **Step 4: Verde + build**

Run: `npm run test --workspace backend -- fileStats` → PASS.
Run: `npm run build --workspace backend` → limpo (se `import.ts`/`upload.ts` falharem porque os fakes de teste ainda não têm `fileStats`, isso é resolvido nas Tasks 4/5; o BUILD de src deve estar limpo — o `index.ts` passa uma instância real de `RequestsRepo`, que tem `fileStats`).

- [ ] **Step 5: Suíte backend**

Run: `npm run test --workspace backend`
Expected: testes de rota `import`/`upload` AGORA podem falhar de compilação porque seus fakes não implementam `fileStats` (interface estendida). Isso é esperado e será corrigido nas Tasks 4/5. Se quiser manter verde aqui, adicione `fileStats: async () => ({ rows: 0, lastIngestedAt: "" })` aos objetos `fakeRepo()` em `backend/tests/import.test.ts` e `backend/tests/upload.test.ts` (apenas o stub, sem novos casos) — e rode de novo até verde. Reporte qual caminho tomou.

- [ ] **Step 6: Commit**

```
git add backend/src/repo/requestsRepo.ts backend/src/ingest/runJob.ts backend/tests/fileStats.test.ts backend/tests/import.test.ts backend/tests/upload.test.ts
git commit -m "feat(api): RequestsRepo.fileStats + IngestJobRepo contract" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Endpoint `GET /api/imports/exists`

**Files:**
- Create: `backend/src/routes/imports.ts`
- Create (test): `backend/tests/imports.test.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Teste RED** — `backend/tests/imports.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerImportsExists } from "../src/routes/imports.js";

function repo(stats: { rows: number; lastIngestedAt: string }) {
  return {
    deleteByFileName: async () => {},
    insertRows: async () => {},
    fileStats: async () => stats,
  };
}

describe("GET /api/imports/exists", () => {
  it("returns exists=true with rows and lastIngestedAt", async () => {
    const app = Fastify();
    registerImportsExists(app, { repo: repo({ rows: 686181, lastIngestedAt: "2026-05-16 23:42:32" }) as never });
    const res = await app.inject({ method: "GET", url: "/api/imports/exists?file=Consultaderequestsresultados635.csv" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ exists: true, rows: 686181, lastIngestedAt: "2026-05-16 23:42:32" });
    await app.close();
  });

  it("returns exists=false when rows=0", async () => {
    const app = Fastify();
    registerImportsExists(app, { repo: repo({ rows: 0, lastIngestedAt: "" }) as never });
    const res = await app.inject({ method: "GET", url: "/api/imports/exists?file=novo.csv" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ exists: false, rows: 0, lastIngestedAt: "" });
    await app.close();
  });

  it("400 when file is missing", async () => {
    const app = Fastify();
    registerImportsExists(app, { repo: repo({ rows: 0, lastIngestedAt: "" }) as never });
    const res = await app.inject({ method: "GET", url: "/api/imports/exists" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

Run: `npm run test --workspace backend -- imports` → FAIL (módulo não existe).

- [ ] **Step 2: Implementar `backend/src/routes/imports.ts`**

```ts
import { basename } from "node:path";
import type { FastifyInstance } from "fastify";
import type { IngestJobRepo } from "../ingest/runJob.js";

interface Deps {
  repo: Pick<IngestJobRepo, "fileStats">;
}

export function registerImportsExists(app: FastifyInstance, deps: Deps): void {
  app.get<{ Querystring: { file?: string } }>(
    "/api/imports/exists",
    async (req, reply) => {
      const requested = req.query.file ?? "";
      const safe = basename(requested);
      if (!safe || safe !== requested) {
        return reply
          .code(400)
          .send({ error: "bad_request", message: "invalid file name" });
      }
      const { rows, lastIngestedAt } = await deps.repo.fileStats(safe);
      return { exists: rows > 0, rows, lastIngestedAt };
    },
  );
}
```

- [ ] **Step 3: Verde**

Run: `npm run test --workspace backend -- imports` → PASS (3 testes).

- [ ] **Step 4: Wire em `backend/src/index.ts`**

Adicionar import perto dos outros de rotas:
```ts
import { registerImportsExists } from "./routes/imports.js";
```
Dentro de `registerExtra: (a) => { ... }`, após `registerImport(a, { cfg, repo, jobs });` adicionar:
```ts
    registerImportsExists(a, { repo });
```
(`repo` é a instância de `RequestsRepo`, que tem `fileStats`.)

- [ ] **Step 5: Build + suíte + commit**

Run: `npm run build --workspace backend` → limpo.
Run: `npm run test --workspace backend` → todas verdes.
```
git add backend/src/routes/imports.ts backend/tests/imports.test.ts backend/src/index.ts
git commit -m "feat(api): GET /api/imports/exists (dedup pre-check)" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `POST /api/import` — 409/replace

**Files:**
- Modify: `backend/src/routes/import.ts`
- Modify (test): `backend/tests/import.test.ts`

- [ ] **Step 1: Adicionar casos RED em `backend/tests/import.test.ts`**

No `fakeRepo()` desse arquivo, garanta que existe `fileStats` configurável. Substitua a definição de `fakeRepo` por:

```ts
function fakeRepo(stats = { rows: 0, lastIngestedAt: "" }) {
  const inserted: unknown[] = [];
  return {
    inserted,
    deleteByFileName: async () => {},
    insertRows: async (r: unknown[]) => { inserted.push(...r); },
    fileStats: async () => stats,
  };
}
```
(Ajuste chamadas existentes `fakeRepo()` — continuam válidas, default rows:0.)

Adicione DOIS testes dentro do `describe`:

```ts
  it("409 already_imported when file exists and no replace", async () => {
    const app = Fastify();
    registerImport(app, {
      cfg: { CARGAS_DIR: join(here, "fixtures"), INGEST_BATCH_SIZE: 2 } as never,
      repo: fakeRepo({ rows: 686181, lastIngestedAt: "2026-05-16 23:42:32" }) as never,
      jobs: new JobStore(),
    });
    const res = await app.inject({
      method: "POST", url: "/api/import",
      payload: { file: "sample.csv" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "already_imported", rows: 686181 });
    await app.close();
  });

  it("replaces (202) when file exists and replace=true", async () => {
    const app = Fastify();
    registerImport(app, {
      cfg: { CARGAS_DIR: join(here, "fixtures"), INGEST_BATCH_SIZE: 2 } as never,
      repo: fakeRepo({ rows: 5, lastIngestedAt: "2026-05-16 00:00:00" }) as never,
      jobs: new JobStore(),
    });
    const res = await app.inject({
      method: "POST", url: "/api/import",
      payload: { file: "sample.csv", replace: true },
    });
    expect(res.statusCode).toBe(202);
    expect((res.json() as { jobId: string }).jobId).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
  });
```

(Os imports `Fastify`, `join`, `here`, `registerImport`, `JobStore` já existem no arquivo.)

Run: `npm run test --workspace backend -- import` → os 2 novos FALHAM (rota ainda não checa fileStats/replace).

- [ ] **Step 2: Implementar em `backend/src/routes/import.ts`**

- Trocar a assinatura do handler para aceitar `replace`:
  `app.post<{ Body: { file?: string; replace?: boolean } }>("/api/import", async (req, reply) => {`
- Após a validação existente (`safe`/`.csv`/`existsSync`) e ANTES de `const job = deps.jobs.create(safe);`, inserir:

```ts
    const replace = req.body?.replace === true;
    if (!replace) {
      const { rows, lastIngestedAt } = await deps.repo.fileStats(safe);
      if (rows > 0) {
        return reply.code(409).send({
          error: "already_imported",
          message: `file already imported (${rows} rows)`,
          rows,
          lastIngestedAt,
        });
      }
    }
```

- Na chamada `startIngestJob({...})` manter `sourceName: safe` (já adicionado na Task 1).
- `Deps.repo` é `IngestJobRepo` (já tem `fileStats` após Task 2). Sem outras mudanças.

- [ ] **Step 3: Verde + suíte + build**

Run: `npm run test --workspace backend -- import` → PASS (todos, incl. os 2 novos + os antigos: 202 normal, `../secrets.txt`→400).
Run: `npm run test --workspace backend` → todas verdes.
Run: `npm run build --workspace backend` → limpo.

- [ ] **Step 4: Commit**

```
git add backend/src/routes/import.ts backend/tests/import.test.ts
git commit -m "feat(api): /api/import 409 already_imported unless replace" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `POST /api/upload` — sourceName original + 409/replace + unlink

**Files:**
- Modify: `backend/src/routes/upload.ts`
- Modify (test): `backend/tests/upload.test.ts`

- [ ] **Step 1: Adicionar casos RED em `backend/tests/upload.test.ts`**

Substitua `fakeRepo()` por uma versão com `fileStats` configurável:

```ts
function fakeRepo(stats = { rows: 0, lastIngestedAt: "" }) {
  const inserted: unknown[] = [];
  return {
    inserted,
    deleteByFileName: async () => {},
    insertRows: async (r: unknown[]) => { inserted.push(...r); },
    fileStats: async () => stats,
  };
}
```
Ajuste o helper `build(maxBytes=0)` para aceitar stats: `async function build(maxBytes = 0, stats = { rows: 0, lastIngestedAt: "" }) { ... const repo = fakeRepo(stats); ... return { app, jobs, repo }; }`.

Adicione, no caso de sucesso já existente, a asserção de que `source_file` é o nome ORIGINAL: após `expect(repo.inserted.length).toBe(1);` adicione
`expect((repo.inserted[0] as { source_file: string }).source_file).toBe("dados.csv");`

Adicione DOIS testes:

```ts
  it("409 already_imported when original name exists and no replace; removes temp file", async () => {
    const { app } = await build(0, { rows: 10, lastIngestedAt: "2026-05-16 00:00:00" });
    const f = form("dados.csv", CSV);
    const res = await app.inject({ method: "POST", url: "/api/upload", payload: f, headers: f.getHeaders() });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "already_imported", rows: 10 });
    expect(readdirSync(dir).length).toBe(0); // arquivo temporário removido
    await app.close();
  });

  it("replace=1 ingests even if original name exists", async () => {
    const { app, repo } = await build(0, { rows: 10, lastIngestedAt: "2026-05-16 00:00:00" });
    const f = form("dados.csv", CSV);
    const res = await app.inject({ method: "POST", url: "/api/upload?replace=1", payload: f, headers: f.getHeaders() });
    expect(res.statusCode).toBe(202);
    // espera o ingest concluir
    for (let i = 0; i < 50; i++) { if (repo.inserted.length >= 1) break; await new Promise((x) => setTimeout(x, 20)); }
    expect((repo.inserted[0] as { source_file: string }).source_file).toBe("dados.csv");
    await app.close();
  });
```

(`form`, `CSV`, `readdirSync`, `dir` já existem no arquivo.)

Run: `npm run test --workspace backend -- upload` → novos FALHAM.

- [ ] **Step 2: Implementar em `backend/src/routes/upload.ts`**

- Tipar query: trocar `app.post("/api/upload", ...)` por
  `app.post<{ Querystring: { replace?: string } }>("/api/upload", async (req, reply) => {`
- Após o bloco do `if (part.file.truncated)` (e ANTES de `const job = deps.jobs.create(unique);`), inserir:

```ts
    const replace = req.query.replace === "1";
    if (!replace) {
      const { rows, lastIngestedAt } = await deps.repo.fileStats(original);
      if (rows > 0) {
        await unlink(dest).catch(() => {});
        return reply.code(409).send({
          error: "already_imported",
          message: `file already imported (${rows} rows)`,
          rows,
          lastIngestedAt,
        });
      }
    }
```

- Na chamada `startIngestJob({...})`, garantir `sourceName: original,` (nome original) e `filePath: dest,` (já ajustado na Task 1 Step 4 — confirmar que é `original`, não `unique`).

- [ ] **Step 3: Verde + suíte + build**

Run: `npm run test --workspace backend -- upload` → PASS (sucesso c/ source_file="dados.csv", non-csv 400, no-file 400, 413+limpa, path-traversal, +409, +replace).
Run: `npm run test --workspace backend` → todas verdes.
Run: `npm run build --workspace backend` → limpo.

- [ ] **Step 4: Commit**

```
git add backend/src/routes/upload.ts backend/tests/upload.test.ts
git commit -m "feat(api): /api/upload source_file=original + 409/replace + temp cleanup" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Cliente frontend — `importExists`, `startImport(replace)`, `uploadFile(replace)`

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify (test): `frontend/src/api/client.test.tsx`

- [ ] **Step 1: Testes RED** — adicionar dentro do `describe("api client", ...)` em `frontend/src/api/client.test.tsx`:

```ts
  it("importExists GETs /api/imports/exists with file param", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ exists: true, rows: 5, lastIngestedAt: "2026-05-16 00:00:00" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await api.importExists("a b.csv");
    expect(r).toEqual({ exists: true, rows: 5, lastIngestedAt: "2026-05-16 00:00:00" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/imports/exists?file=a%20b.csv");
  });

  it("startImport sends replace flag", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobId: "j1" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.startImport("x.csv", true);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body).toEqual({ file: "x.csv", replace: true });
  });

  it("uploadFile appends ?replace=1 when replace=true", async () => {
    const opened: string[] = [];
    const xhrMock = {
      upload: { addEventListener: () => {} },
      addEventListener: (k: string, cb: () => void) => { if (k === "load") setTimeout(cb, 0); },
      open: (_m: string, u: string) => opened.push(u),
      send: () => {},
      setRequestHeader: () => {},
      status: 202,
      responseText: JSON.stringify({ jobId: "j2" }),
    };
    vi.stubGlobal("XMLHttpRequest", function () { return xhrMock; } as unknown);
    const file = new File([new Uint8Array(2)], "y.csv", { type: "text/csv" });
    await api.uploadFile(file, undefined, true);
    expect(opened[0]).toContain("/api/upload?replace=1");
  });
```

Run: `npm run test --workspace frontend -- client` → 3 novos FALHAM.

- [ ] **Step 2: Implementar em `frontend/src/api/client.ts`**

- Após `post<T>`/antes de `uploadFile`, adicionar tipo:
```ts
export interface ImportExists { exists: boolean; rows: number; lastIngestedAt: string; }
```
- Alterar `post<T>` para aceitar replace? Não — manter `post` genérico. Alterar a assinatura de `uploadFile`:
```ts
function uploadFile(
  file: File,
  onProgress?: (p: UploadProgress) => void,
  replace = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/api/upload${replace ? "?replace=1" : ""}`);
    // ...resto idêntico ao atual (progress/load/error/FormData/send)...
```
(Mantenha exatamente o restante do corpo atual de `uploadFile`; só muda a linha do `xhr.open` e a adição do 3º parâmetro `replace`.)
- No objeto `api`, trocar a entrada `startImport` e adicionar `importExists`:
```ts
  startImport: (file: string, replace = false) =>
    post<{ jobId: string }>("/api/import", { file, replace }),
  importExists: (file: string) =>
    get<ImportExists>(`/api/imports/exists?file=${encodeURIComponent(file)}`),
```
(`uploadFile` permanece referenciado por `uploadFile,` no objeto.)

- [ ] **Step 3: Verde + suíte + build + commit**

Run: `npm run test --workspace frontend -- client` → PASS.
Run: `npm run test --workspace frontend` → todas verdes (client, AsyncState, Dashboard, Requests, Import, ProgressMonitor).
Run: `npm run build --workspace frontend` → limpo (aviso >500kB ok).
```
git add frontend/src/api/client.ts frontend/src/api/client.test.tsx
git commit -m "feat(web): client importExists + replace flag (import/upload)" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Import.tsx — pré-check + aviso + confirmar

**Files:**
- Modify: `frontend/src/pages/Import.tsx`
- Modify (test): `frontend/src/pages/Import.test.tsx`

- [ ] **Step 1: Atualizar `frontend/src/pages/Import.test.tsx`** — substituir TODO o conteúdo por:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Import } from "./Import.js";
import { api } from "../api/client.js";

afterEach(() => vi.restoreAllMocks());

describe("Import", () => {
  it("server file: not imported -> imports directly and shows ProgressMonitor done", async () => {
    vi.spyOn(api, "files").mockResolvedValue([{ name: "sample.csv", size: 10, modified: "2026-05-16T00:00:00Z" }]);
    vi.spyOn(api, "importExists").mockResolvedValue({ exists: false, rows: 0, lastIngestedAt: "" });
    const startSpy = vi.spyOn(api, "startImport").mockResolvedValue({ jobId: "job-1" });
    vi.spyOn(api, "importStatus").mockResolvedValue({ id: "job-1", file: "sample.csv", status: "done", rowsProcessed: 3, rowsInserted: 3, parseErrors: 0, error: null, startedAt: "2026-05-16 10:00:00", finishedAt: "2026-05-16 10:00:01" });

    render(<Import />);
    await waitFor(() => expect(screen.getByText("sample.csv")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /importar/i }));
    await waitFor(() => expect(screen.getByText(/Ingest[aã]o conclu/i)).toBeInTheDocument(), { timeout: 5000 });
    expect(startSpy).toHaveBeenCalledWith("sample.csv", false);
  });

  it("server file: already imported -> shows warning, confirm reprocess sends replace=true", async () => {
    vi.spyOn(api, "files").mockResolvedValue([{ name: "sample.csv", size: 10, modified: "2026-05-16T00:00:00Z" }]);
    vi.spyOn(api, "importExists").mockResolvedValue({ exists: true, rows: 686181, lastIngestedAt: "2026-05-16 23:42:32" });
    const startSpy = vi.spyOn(api, "startImport").mockResolvedValue({ jobId: "job-2" });
    vi.spyOn(api, "importStatus").mockResolvedValue({ id: "job-2", file: "sample.csv", status: "done", rowsProcessed: 1, rowsInserted: 1, parseErrors: 0, error: null, startedAt: "2026-05-16 10:00:00", finishedAt: "2026-05-16 10:00:01" });

    render(<Import />);
    await waitFor(() => expect(screen.getByText("sample.csv")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /importar/i }));
    await waitFor(() => expect(screen.getByText(/já foi importado/i)).toBeInTheDocument());
    expect(screen.getByText(/686181/)).toBeInTheDocument();
    expect(startSpy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /reprocessar/i }));
    expect(startSpy).toHaveBeenCalledWith("sample.csv", true);
    await waitFor(() => expect(screen.getByText(/Ingest[aã]o conclu/i)).toBeInTheDocument(), { timeout: 5000 });
  });

  it("upload: already imported -> warning, cancel does not upload", async () => {
    vi.spyOn(api, "files").mockResolvedValue([]);
    vi.spyOn(api, "importExists").mockResolvedValue({ exists: true, rows: 9, lastIngestedAt: "2026-05-16 00:00:00" });
    const upSpy = vi.spyOn(api, "uploadFile").mockResolvedValue("job-7");

    render(<Import />);
    const input = await screen.findByLabelText(/arquivo do meu computador/i) as HTMLInputElement;
    await userEvent.upload(input, new File(["a\n"], "u.csv", { type: "text/csv" }));
    await userEvent.click(screen.getByRole("button", { name: /enviar/i }));
    await waitFor(() => expect(screen.getByText(/já foi importado/i)).toBeInTheDocument());
    expect(upSpy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /cancelar/i }));
    await waitFor(() => expect(screen.queryByText(/já foi importado/i)).toBeNull());
    expect(upSpy).not.toHaveBeenCalled();
  });
});
```

Run: `npm run test --workspace frontend -- Import` → FALHA (sem fluxo de aviso).

- [ ] **Step 2: Implementar `frontend/src/pages/Import.tsx`** — substituir TODO o conteúdo por:

```tsx
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
          disabled={!picked || phase !== "idle"}
          onClick={onSendUpload}
        >
          Enviar
        </button>
      </section>

      {pending && (
        <div className="rounded border border-amber-400 bg-amber-50 p-4 text-sm">
          <p>
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
                      className="rounded bg-slate-900 px-3 py-1 text-white"
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
```

- [ ] **Step 3: Verde + suíte + build**

Run: `npm run test --workspace frontend -- Import` → PASS (3 testes).
Run: `npm run test --workspace frontend` → todas verdes; rode 2x se suspeitar de flakiness de timing e reporte ambas.
Run: `npm run build --workspace frontend` → limpo (aviso >500kB ok).

- [ ] **Step 4: Commit**

```
git add frontend/src/pages/Import.tsx frontend/src/pages/Import.test.tsx
git commit -m "feat(web): pre-check + reprocess confirmation on Import page" -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Verificação final + push + deploy + smoke real

**Files:** nenhum (operacional).

- [ ] **Step 1: Suíte completa + build (raiz)**

Run: `npm test`
Expected: backend (config, csv×3, jobStore, ingestService, health, files, import, requests, upload, whereClause, fileStats, imports) e frontend (client, AsyncState, Dashboard, Requests, Import, ProgressMonitor) — todos verdes, 0 skips.
Run: `npm run build`
Expected: ambos limpos.

- [ ] **Step 2: Push para `main`**

```
git push origin HEAD:main
```
Expected: push ok p/ https://github.com/wmarrane/webhookmonitor.

- [ ] **Step 3: Redeploy no servidor 192.168.56.113**

Recriar `/tmp/askpass.sh` (`echo '123'`, chmod +x). Via:
`SSH_ASKPASS=/tmp/askpass.sh SSH_ASKPASS_REQUIRE=force ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=1 wagner@192.168.56.113`
executar no servidor:
```bash
cd ~/webhookmonitor && git fetch -q origin main && git reset -q --hard origin/main && \
echo 123 | sudo -S -p "" docker compose up -d --build
```
Aguardar `monitor-api` `healthy` (loop inspecionando `.State.Health.Status`, ~5min máx) e `curl http://127.0.0.1:8091/api/health` → `{"status":"ok","clickhouse":true}`.

- [ ] **Step 4: Smoke real do controle de duplicidade**

No servidor (o arquivo grande já está em `~/webhookmonitor/cargas/Consultaderequestsresultados635.csv` e já foi importado antes):
```bash
# 1) exists deve indicar já importado
curl -s "http://127.0.0.1:8091/api/imports/exists?file=Consultaderequestsresultados635.csv"
# 2) import sem replace deve dar 409
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8091/api/import \
  -H "content-type: application/json" -d '{"file":"Consultaderequestsresultados635.csv"}'
# 3) total antes
curl -s "http://192.168.56.127:8123/?user=wagner&password=123" --data-binary \
  "SELECT count() FROM monitor.requests WHERE source_file='Consultaderequestsresultados635.csv'"
# 4) import com replace=true -> 202 jobId; aguardar done; total deve continuar ~686181 (não duplicar)
JID=$(curl -s -X POST http://127.0.0.1:8091/api/import -H "content-type: application/json" \
  -d '{"file":"Consultaderequestsresultados635.csv","replace":true}' | sed -E 's/.*"jobId":"([^"]+)".*/\1/')
# poll http://127.0.0.1:8091/api/import/$JID até status done; depois recontar
```
Expected: (1) `{"exists":true,"rows":686181,...}`; (2) `409`; (4) após replace `done`, `SELECT count()` permanece **686181** (substituiu, não duplicou — não 1.372.362). Reportar números reais (sem fabricar).

- [ ] **Step 5: Verificação externa**

Da máquina de dev: `curl http://192.168.56.113:8091/api/imports/exists?file=Consultaderequestsresultados635.csv` e abrir `http://192.168.56.113:8090` (aba Importação → clicar "Importar" no arquivo deve mostrar o aviso de já-importado). Reportar status final.

---

## Self-Review Notes (resolved)

- **Spec coverage:** source_file = nome original (Task 1, threading sourceName; upload usa `original`); `fileStats` + query pura (Task 2); `GET /api/imports/exists` (Task 3); `/api/import` 409/replace (Task 4); `/api/upload` 409/replace + unlink + source_file original (Task 5); cliente `importExists`/`replace` (Task 6); UI pré-check+aviso+confirmar/cancelar (Task 7); 409 inesperado cai no `setError` (mensagem já exibida); smoke real reimport sem duplicar (Task 8). Fora de escopo (engine, atomicidade, migração de source_file antigos) — não há tasks, conforme spec §6.
- **Placeholder scan:** sem TBD/TODO. Edições a testes existentes (ingestService/import/upload/Import) são deltas determinísticos e explícitos (adicionar campo `fileStats` ao fake, adicionar casos, trocar `fakeRepo` por versão paramétrica) — não placeholders.
- **Type consistency:** `sourceName` adicionado a `StartIngestJobOptions` e `IngestOptions`; `IngestJobRepo` += `fileStats` (RequestsRepo implementa em Task 2 antes de Tasks 4/5 usarem; Task 2 Step 5 mantém fakes compilando). `ImportExists {exists,rows,lastIngestedAt}` consistente entre `requestsRepo.fileStats`, rota `exists`, cliente e Import.tsx. `startImport(file, replace=false)` e `uploadFile(file,onProgress,replace=false)` assinaturas consistentes entre client e Import.tsx. `?replace=1` (upload) vs `{replace:true}` (import) conforme spec.
- **Ordering:** Task 1 introduz `sourceName` e ajusta chamadas em import/upload para compilar; Task 2 estende `IngestJobRepo` e adiciona stub `fileStats` aos fakes (mantém suíte verde) antes de Tasks 4/5 adicionarem os casos 409/replace.
