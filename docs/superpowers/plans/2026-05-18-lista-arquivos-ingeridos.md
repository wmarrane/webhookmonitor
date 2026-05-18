# Lista de Arquivos Ingeridos + Status — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir na tela Importação uma lista dos arquivos já ingeridos no ClickHouse com linhas, última ingestão e status derivado (Concluído / Importando… / Falhou).

**Architecture:** Backend ganha consulta pura `buildImportsListQuery`, método `RequestsRepo.listImported()` e rota `GET /api/imports`. Frontend ganha `api.imports()` e um painel na página Importação que cruza a lista persistente com o job acompanhado no `poll` para derivar o status; recarrega a lista ao fim de cada job.

**Tech Stack:** Fastify 5, @clickhouse/client, vitest (backend node); React 19, Vite, Tailwind, @testing-library/react, vitest (frontend jsdom).

Spec: `docs/superpowers/specs/2026-05-18-lista-arquivos-ingeridos-design.md`

---

## File Structure

- `backend/src/repo/requestsRepo.ts` — adicionar `buildImportsListQuery(db)` (export) e método `listImported()`.
- `backend/src/routes/imports.ts` — adicionar `registerImportsList(app, { repo })`.
- `backend/src/index.ts` — registrar `registerImportsList(a, { repo })`.
- `backend/tests/importsList.test.ts` — novo: teste puro de `buildImportsListQuery`.
- `backend/tests/imports.test.ts` — adicionar testes de `GET /api/imports`.
- `frontend/src/api/client.ts` — `ImportedFile` + `api.imports`.
- `frontend/src/api/client.test.tsx` — teste de `api.imports`.
- `frontend/src/pages/Import.tsx` — painel "Arquivos importados" + status + reload pós-job.
- `frontend/src/pages/Import.test.tsx` — `beforeEach` default-mock de `api.imports` + testes do painel.

---

## Task 1: Backend — `buildImportsListQuery` (consulta pura)

**Files:**
- Modify: `backend/src/repo/requestsRepo.ts`
- Test: `backend/tests/importsList.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/importsList.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildImportsListQuery } from "../src/repo/requestsRepo.js";

describe("buildImportsListQuery", () => {
  it("builds a grouped count+max(ingested_at) query per source_file", () => {
    const q = buildImportsListQuery("monitor");
    expect(q.query).toContain("FROM `monitor`.requests");
    expect(q.query).toContain("source_file AS file");
    expect(q.query).toContain("count() AS rows");
    expect(q.query).toContain("toString(max(ingested_at)) AS lastIngestedAt");
    expect(q.query).toContain("GROUP BY source_file");
    expect(q.query).toContain("ORDER BY lastIngestedAt DESC");
    expect(q.params).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/importsList.test.ts`
Expected: FAIL — `buildImportsListQuery` is not exported / not a function.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/repo/requestsRepo.ts`, after `buildFileStatsQuery` (ends at the line `}` closing that function, around line 61), add:

```ts
export function buildImportsListQuery(
  db: string,
): { query: string; params: Record<string, unknown> } {
  return {
    query: `SELECT source_file AS file, count() AS rows, toString(max(ingested_at)) AS lastIngestedAt FROM \`${db}\`.requests GROUP BY source_file ORDER BY lastIngestedAt DESC`,
    params: {},
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/importsList.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/repo/requestsRepo.ts backend/tests/importsList.test.ts
git commit -m "feat(api): buildImportsListQuery — grouped per source_file

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Backend — `RequestsRepo.listImported()` + rota `GET /api/imports`

**Files:**
- Modify: `backend/src/repo/requestsRepo.ts` (add method `listImported`)
- Modify: `backend/src/routes/imports.ts` (add `registerImportsList`)
- Modify: `backend/src/index.ts` (wire route)
- Test: `backend/tests/imports.test.ts` (add cases)

- [ ] **Step 1: Write the failing test**

In `backend/tests/imports.test.ts`, add this import at the top (keep the existing `registerImportsExists` import line; add alongside it):

```ts
import { registerImportsList } from "../src/routes/imports.js";
```

Then append, before the final closing of the file (after the last `});` of the existing `describe`):

```ts
describe("GET /api/imports", () => {
  it("returns the list of imported files", async () => {
    const app = Fastify();
    const files = [
      { file: "Consultaderequestsresultados635.csv", rows: 686181, lastIngestedAt: "2026-05-17 02:51:52" },
      { file: "dados.csv", rows: 10, lastIngestedAt: "2026-05-16 00:00:00" },
    ];
    registerImportsList(app, { repo: { listImported: async () => files } as never });
    const res = await app.inject({ method: "GET", url: "/api/imports" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ files });
    await app.close();
  });

  it("returns an empty list when nothing was imported", async () => {
    const app = Fastify();
    registerImportsList(app, { repo: { listImported: async () => [] } as never });
    const res = await app.inject({ method: "GET", url: "/api/imports" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ files: [] });
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/imports.test.ts`
Expected: FAIL — `registerImportsList` is not exported.

- [ ] **Step 3: Write minimal implementation**

3a. In `backend/src/repo/requestsRepo.ts`, add this method to the `RequestsRepo` class, immediately after the `fileStats` method (before the closing `}` of the class):

```ts
  async listImported(): Promise<{ file: string; rows: number; lastIngestedAt: string }[]> {
    const { query, params } = buildImportsListQuery(this.db);
    const res = await this.client.query({ query, query_params: params, format: "JSON" });
    const data = (await res.json()).data as { file: string; rows: string; lastIngestedAt: string }[];
    return data.map((r) => ({
      file: r.file,
      rows: Number(r.rows ?? 0),
      lastIngestedAt: r.lastIngestedAt ?? "",
    }));
  }
```

3b. In `backend/src/routes/imports.ts`, append after `registerImportsExists`:

```ts
interface ListDeps {
  repo: { listImported: () => Promise<{ file: string; rows: number; lastIngestedAt: string }[]> };
}

export function registerImportsList(app: FastifyInstance, deps: ListDeps): void {
  app.get("/api/imports", async () => {
    const files = await deps.repo.listImported();
    return { files };
  });
}
```

3c. In `backend/src/index.ts`, change the import line

```ts
import { registerImportsExists } from "./routes/imports.js";
```

to

```ts
import { registerImportsExists, registerImportsList } from "./routes/imports.js";
```

and add, immediately after the `registerImportsExists(a, { repo });` line:

```ts
    registerImportsList(a, { repo });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/imports.test.ts tests/importsList.test.ts && npx tsc --noEmit`
Expected: PASS (all imports.test.ts + importsList.test.ts cases); tsc no errors.

- [ ] **Step 5: Run full backend suite**

Run: `cd backend && npx vitest run`
Expected: all test files pass (no regressions).

- [ ] **Step 6: Commit**

```bash
git add backend/src/repo/requestsRepo.ts backend/src/routes/imports.ts backend/src/index.ts backend/tests/imports.test.ts
git commit -m "feat(api): GET /api/imports lists ingested files + RequestsRepo.listImported

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Frontend — `api.imports()` + tipo `ImportedFile`

**Files:**
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.tsx` (add case)

- [ ] **Step 1: Write the failing test**

In `frontend/src/api/client.test.tsx`, add inside the `describe("api client", ...)` block (after the existing `startImport ... 409` test, before the `uploadFile` test):

```ts
  it("imports() GETs /api/imports and parses { files }", async () => {
    const files = [{ file: "a.csv", rows: 5, lastIngestedAt: "2026-05-16 00:00:00" }];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ files }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await api.imports();
    expect(res).toEqual({ files });
    expect(fetchMock.mock.calls[0][0]).toContain("/api/imports");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/api/client.test.tsx`
Expected: FAIL — `api.imports` is not a function.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/api/client.ts`:

3a. Add the interface next to `ImportExists` (after the line `export interface ImportExists { ... }`):

```ts
export interface ImportedFile { file: string; rows: number; lastIngestedAt: string; }
```

3b. In the `export const api = { ... }` object, add this property (e.g. right after the `importExists:` entry):

```ts
  imports: () => get<{ files: ImportedFile[] }>("/api/imports"),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/api/client.test.tsx`
Expected: PASS (all api client cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.test.tsx
git commit -m "feat(web): api.imports() client + ImportedFile type

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Frontend — painel "Arquivos importados" na tela Importação

**Files:**
- Modify: `frontend/src/pages/Import.tsx`
- Test: `frontend/src/pages/Import.test.tsx`

- [ ] **Step 1: Add default mock + write failing tests**

1a. In `frontend/src/pages/Import.test.tsx`, change the imports line 1 to also import `beforeEach`:

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
```

1b. Immediately after the `afterEach(() => vi.restoreAllMocks());` line, add a default mock so existing tests don't hit the network:

```ts
beforeEach(() => {
  vi.spyOn(api, "imports").mockResolvedValue({ files: [] });
});
```

1c. Append these tests inside the `describe("Import", ...)` block (before its closing `});`):

```ts
  it('imported panel lists files with rows/date and status "Concluído"', async () => {
    vi.spyOn(api, "files").mockResolvedValue([]);
    vi.spyOn(api, "imports").mockResolvedValue({
      files: [{ file: "Consultaderequestsresultados635.csv", rows: 686181, lastIngestedAt: "2026-05-17 02:51:52" }],
    });
    render(<Import />);
    await waitFor(() =>
      expect(screen.getByText("Consultaderequestsresultados635.csv")).toBeInTheDocument(),
    );
    expect(screen.getByText("2026-05-17 02:51:52")).toBeInTheDocument();
    expect(screen.getByText(/Conclu[ií]do/)).toBeInTheDocument();
  });

  it('imported panel shows "Importando…" while a matching job runs', async () => {
    vi.spyOn(api, "files").mockResolvedValue([{ name: "x.csv", size: 10, modified: "2026-05-16T00:00:00Z" }]);
    vi.spyOn(api, "imports").mockResolvedValue({
      files: [{ file: "x.csv", rows: 100, lastIngestedAt: "2026-05-16 00:00:00" }],
    });
    vi.spyOn(api, "importExists").mockResolvedValue({ exists: false, rows: 0, lastIngestedAt: "" });
    vi.spyOn(api, "startImport").mockResolvedValue({ jobId: "job-9" });
    vi.spyOn(api, "importStatus").mockResolvedValue({ id: "job-9", file: "x.csv", status: "running", rowsProcessed: 1, rowsInserted: 0, parseErrors: 0, error: null, startedAt: "2026-05-16 10:00:00", finishedAt: null });
    render(<Import />);
    await waitFor(() => expect(screen.getByRole("button", { name: /importar/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /importar/i }));
    await waitFor(() => expect(screen.getByText(/Importando/)).toBeInTheDocument(), { timeout: 5000 });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/Import.test.tsx`
Expected: FAIL — the two new tests fail (no "Arquivos importados" table / no "Concluído" / no "Importando" text). Existing tests still pass.

- [ ] **Step 3: Implement the panel in `Import.tsx`**

3a. Update the client import (line 2) to include `ImportedFile`:

```ts
import { api, type FileInfo, type ImportJob, type ImportedFile, type UploadProgress } from "../api/client.js";
```

3b. Add state after the `const [pending, setPending] = useState<Pending | null>(null);` line:

```ts
  const [imported, setImported] = useState<ImportedFile[] | null>(null);
  const [importedError, setImportedError] = useState<string | null>(null);
```

3c. Add the loader and call it on mount. Replace the existing `useEffect` block:

```ts
  useEffect(() => {
    api.files().then(setFiles).catch((e: Error) => setError(e.message));
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);
```

with:

```ts
  const loadImported = () =>
    api
      .imports()
      .then((r) => { setImported(r.files); setImportedError(null); })
      .catch((e: Error) => setImportedError(e.message));

  useEffect(() => {
    api.files().then(setFiles).catch((e: Error) => setError(e.message));
    loadImported();
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);
```

3d. In the `poll` function, recarregar a lista quando o job terminar. Replace this block:

```ts
        if (j.status !== "running" && timer.current) {
          clearInterval(timer.current); timer.current = null;
        }
```

with:

```ts
        if (j.status !== "running" && timer.current) {
          clearInterval(timer.current); timer.current = null;
          loadImported();
        }
```

3e. Add the status helper just before the `return (` of the component:

```ts
  const statusOf = (file: string): { label: string; cls: string } => {
    if (job?.file === file && job.status === "running")
      return { label: "Importando…", cls: "text-amber-700" };
    if (job?.file === file && job.status === "failed")
      return { label: "Falhou", cls: "text-red-700" };
    return { label: "Concluído", cls: "text-green-700" };
  };
```

3f. Insert the panel JSX immediately after the closing `</AsyncState>` of the `/cargas` table (the one that wraps the `files` table) and before the `{phase !== "idle" && (` block:

```tsx
      <section className="rounded bg-white p-4 shadow space-y-2">
        <h2 className="font-semibold">Arquivos importados</h2>
        <AsyncState
          loading={!imported && !importedError}
          error={importedError}
          empty={!!imported && imported.length === 0}
        >
          {imported && (
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="p-2">Arquivo</th>
                  <th className="p-2">Linhas</th>
                  <th className="p-2">Última ingestão</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {imported.map((it) => {
                  const s = statusOf(it.file);
                  return (
                    <tr key={it.file} className="border-b">
                      <td className="p-2">{it.file}</td>
                      <td className="p-2">{it.rows.toLocaleString("pt-BR")}</td>
                      <td className="p-2">{it.lastIngestedAt}</td>
                      <td className={`p-2 font-medium ${s.cls}`}>{s.label}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </AsyncState>
      </section>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/Import.test.tsx`
Expected: PASS — new panel tests pass; all existing Import tests still pass.

- [ ] **Step 5: Full frontend suite + build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all frontend tests pass; build succeeds (the >500kB chunk warning is pre-existing and acceptable).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Import.tsx frontend/src/pages/Import.test.tsx
git commit -m "feat(web): 'Arquivos importados' panel with status on Import page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Verificação final + deploy

- [ ] **Step 1: Full suites + typecheck**

Run: `cd backend && npx vitest run && npx tsc --noEmit && cd ../frontend && npx vitest run && npm run build`
Expected: backend all green; tsc clean; frontend all green; build ok.

- [ ] **Step 2: Push**

```bash
git push origin HEAD:main
```

- [ ] **Step 3: Redeploy 192.168.56.113**

SSH (askpass `123`): `cd ~/webhookmonitor && git fetch origin && git reset --hard origin/main && sudo docker compose up -d --build` ; aguardar `monitor-api` healthy.

- [ ] **Step 4: Verificação real**

`curl -s http://127.0.0.1:8091/api/imports` → JSON `{ files: [...] }` contendo `Consultaderequestsresultados635.csv` com `rows: 686181` e `lastIngestedAt` preenchido. Abrir a tela Importação e confirmar o painel "Arquivos importados" listando o arquivo como "Concluído".

- [ ] **Step 5: finishing-a-development-branch**

Invoke superpowers:finishing-a-development-branch.

---

## Self-Review

**Spec coverage:**
- §3.1 backend repo+endpoint → Task 1 (`buildImportsListQuery`) + Task 2 (`listImported`, `registerImportsList`, index wiring). ✓
- §3.2 frontend API client → Task 3. ✓
- §3.3 UI panel + status derivation + reload pós-job → Task 4 (state, loader, poll reload, statusOf, JSX). ✓
- §4 erros (CH down → AsyncState error; vazio → AsyncState empty; falha reload isolada) → Task 4 (importedError + AsyncState; loader catch isolated from poll). ✓
- §5 testes → Task 1/2/3/4 tests; Task 5 full suites + real verification. ✓
- §6 YAGNI (sem paginação, sem JobStore exposto, sem delete, sem auto-refresh) → respeitado (rota sem params, status só do `job` rastreado, reload só no mount/fim de job). ✓

**Placeholder scan:** Nenhum TBD/TODO; todo passo com código completo. ✓

**Type consistency:** `ImportedFile = { file: string; rows: number; lastIngestedAt: string }` consistente entre `buildImportsListQuery` (colunas `file`/`rows`/`lastIngestedAt`), `listImported()`, rota (`{ files }`), `api.imports` (`{ files: ImportedFile[] }`) e `Import.tsx` (`imported.map`/`statusOf`). `statusOf` usa `job?.file`/`job.status` consistentes com `ImportJob`. ✓
