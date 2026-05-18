# Lista de Arquivos Ingeridos + Status — Design

Data: 2026-05-18

## 1. Objetivo

Na tela Importação, exibir uma lista dos arquivos com ingestão já
persistida no ClickHouse, mostrando linhas, data da última ingestão e um
status derivado (Concluído / Importando… / Falhou) do job acompanhado na
sessão atual.

## 2. Contexto e problema

- A tela Importação (`frontend/src/pages/Import.tsx`) lista apenas os
  arquivos de `/cargas` (`GET /api/files`: nome + tamanho + botão Importar).
  Não há indicação do que já foi ingerido nem do status.
- Fontes de verdade:
  - **ClickHouse** `monitor.requests` (`source_file`, `ingested_at`) —
    persistente; representa "ingestão completa".
  - **JobStore** em memória (`backend/src/ingest/jobStore.ts`) — status
    `running/done/failed` da sessão atual; efêmero (perde no restart).
- Já existe `RequestsRepo.fileStats(file)` (1 arquivo) e o padrão de
  consulta pura `buildFileStatsQuery` testável isoladamente.
- Decisões do usuário: base = ClickHouse (persistente) **combinada** com
  sobreposição do status do job já rastreado no front; exibir na própria
  tela Importação; colunas **Arquivo, Linhas, Última ingestão, Status**;
  abordagem A (endpoint ClickHouse + overlay do job atual, sem expor o
  JobStore inteiro).

## 3. Arquitetura

### 3.1 Backend — repo + endpoint

- `backend/src/repo/requestsRepo.ts`: nova função pura exportada
  `buildImportsListQuery(db: string)` (mesmo padrão de `buildFileStatsQuery`):
  ```
  SELECT source_file AS file, count() AS rows,
         toString(max(ingested_at)) AS lastIngestedAt
  FROM `<db>`.requests
  GROUP BY source_file
  ORDER BY lastIngestedAt DESC
  ```
  Retorna `{ query, params: {} }`. Testável sem ClickHouse.
- Método `RequestsRepo.listImported(): Promise<ImportedFile[]>` onde
  `ImportedFile = { file: string; rows: number; lastIngestedAt: string }`.
  Coerção `Number(rows)` (igual a `fileStats`); `lastIngestedAt` como string.
- `backend/src/routes/imports.ts` (já hospeda `registerImportsExists`):
  nova função `registerImportsList(app, { repo })` onde
  `repo: { listImported(): Promise<ImportedFile[]> }` (mesmo estilo de
  injeção mínima por `Pick`/interface estreita das rotas existentes, ex.
  `registerImportsExists` usa `Pick<IngestJobRepo, "fileStats">`).
  Registra **`GET /api/imports`** → `200 { files: ImportedFile[] }`.
  Sem parâmetros.
- `backend/src/index.ts`: registrar `registerImportsList(a, { repo })`
  junto às demais rotas de import.

### 3.2 Frontend — API client

- `frontend/src/api/client.ts`:
  - `export interface ImportedFile { file: string; rows: number; lastIngestedAt: string; }`
  - `api.imports: () => get<{ files: ImportedFile[] }>("/api/imports")`

### 3.3 Frontend — UI (seção na tela Importação)

- Novo painel **abaixo** da tabela de `/cargas`, título "Arquivos importados".
- Estado próprio (`imported`, `importedError`); carrega `api.imports()` no
  mount; usa `AsyncState` para loading/erro/vazio (padrão da lista `/cargas`).
- Tabela: **Arquivo | Linhas | Última ingestão | Status**.
- Status derivado no cliente a partir do `job` já acompanhado pelo `poll`:
  - `job?.file === row.file` e `job.status === "running"` → **"Importando…"**
  - `job?.file === row.file` e `job.status === "failed"` → **"Falhou"**
    (badge vermelho)
  - caso contrário → **"Concluído"** (badge verde)
- Ao fim do `poll` (quando `status !== "running"`), recarrega
  `api.imports()` para refletir novas linhas / última ingestão sem reload
  manual. Falha nessa recarga afeta só o painel da lista (não o job/poll).

## 4. Tratamento de erros

| Situação | Resultado |
|---|---|
| ClickHouse indisponível em `GET /api/imports` | erro propagado → `AsyncState` mostra mensagem |
| Nenhum arquivo ingerido (`files: []`) | estado "vazio" do `AsyncState` |
| Falha ao recarregar a lista pós-job | erro só no painel da lista; job/poll seguem |

## 5. Testes (TDD)

- **Backend:**
  - `buildImportsListQuery` — teste puro de SQL+params (padrão
    `buildWhereClause`/`buildFileStatsQuery`).
  - `GET /api/imports` — repo fake retornando lista → `200 { files }`;
    lista vazia → `{ files: [] }`.
- **Frontend:**
  - `client.test.tsx` — `api.imports()` faz o GET correto e parseia
    `{ files }`.
  - `Import.test.tsx` — renderiza a tabela (linhas/última ingestão);
    status "Concluído" sem job; "Importando…" quando job running casa
    pelo nome do arquivo; "Falhou" quando job failed; recarrega a lista
    após o job terminar.
- Suíte completa verde + builds limpos; commit por tarefa (trailer
  Co-Authored-By); push origin main; redeploy 192.168.56.113 e
  verificação real: a lista exibe `Consultaderequestsresultados635.csv`
  com 686.181 linhas e a data de última ingestão.

## 6. Fora de escopo (YAGNI)

- Paginação / ordenação configurável da lista.
- Expor todo o JobStore (abordagem B) ou status vivo de jobs de outras
  sessões/abas.
- Excluir/reprocessar arquivo a partir desta lista (o reprocesso continua
  pelo fluxo existente de Importar/Enviar com aviso).
- Auto-refresh periódico — a lista só recarrega no mount e ao fim de um job.
