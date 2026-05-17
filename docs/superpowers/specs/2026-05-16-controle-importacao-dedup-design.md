# Controle de Importação Anti-Duplicidade — Design

Data: 2026-05-16

## 1. Objetivo

Evitar duplicação de dados no ClickHouse ao importar/reimportar arquivos, e
oferecer um fluxo de reprocessamento que substitui (não duplica) os dados de
um arquivo já importado, com aviso e confirmação do usuário.

## 2. Contexto e problema

- Tabela `monitor.requests` (engine `MergeTree`, não deduplica). Coluna
  `source_file String`.
- Import de `/cargas` (`POST /api/import`): `source_file` = nome do arquivo;
  fluxo faz `deleteByFileName(source_file)` + reinsere → reimportar o mesmo
  nome já é idempotente.
- Upload pelo navegador (`POST /api/upload`): grava em disco com nome único
  `stem-Date.now()-hex.csv` e usa esse nome único como `source_file`. **Furo:**
  enviar o mesmo arquivo 2x gera `source_file` diferentes → linhas duplicadas.
- Decisões do usuário: duplicidade é controlada pelo **nome original do
  arquivo**; ao reprocessar um arquivo já importado, **substituir com aviso**
  (detectar, avisar, confirmar, então substituir).

## 3. Arquitetura

### 3.1 Identidade por nome original

- O arquivo enviado continua salvo em disco com **nome único** (evita colisão
  e concorrência), mas a coluna **`source_file` passa a guardar o nome
  ORIGINAL** do arquivo.
- `startIngestJob` (`backend/src/ingest/runJob.ts`) e `ingestCsv`
  (`backend/src/ingest/ingestService.ts`) ganham um parâmetro explícito
  `sourceName: string` — o valor gravado em `source_file` — **separado** do
  `filePath` (caminho lido em disco). `mapRow` passa a receber `sourceName`
  em vez de derivar `basename(filePath)`.
  - Import de `/cargas`: `sourceName = basename(file)` (igual ao
    comportamento atual; `filePath = join(CARGAS_DIR, file)`).
  - Upload: `sourceName = basename(part.filename)` (nome original do usuário);
    `filePath = join(UPLOAD_DIR, nomeUnico)`.

### 3.2 Detecção + substituição (backend)

- `RequestsRepo.fileStats(name)`: `SELECT count() AS rows,
  toString(max(ingested_at)) AS lastIngestedAt FROM \`<db>\`.requests
  WHERE source_file = {name:String}` → `{ rows: number, lastIngestedAt: string }`
  (`lastIngestedAt` vazio quando `rows = 0`). A construção é extraída como
  função/consulta testável no mesmo padrão de `buildWhereClause`.
- Novo endpoint **`GET /api/imports/exists?file=<nomeOriginal>`** →
  `200 { exists: boolean, rows: number, lastIngestedAt: string }`. Valida o
  `file` com `basename` (sem path traversal); `400` se vazio.
- `POST /api/import` (body `{ file: string, replace?: boolean }`) e
  `POST /api/upload` (query string **`?replace=1`** — escolhido por ser
  multipart, o corpo é o arquivo) passam a aplicar a regra de deduplicação:
  - Determinar `sourceName` (nome original) e consultar `fileStats(sourceName)`.
  - Se `rows > 0` **e** `replace` ≠ `true` → responder
    **`409 { error: "already_imported", message, rows, lastIngestedAt }`**.
    No upload, o arquivo temporário recém-gravado é removido
    (`unlink`) antes de responder 409 (sem duplicar; desperdício mínimo).
  - Senão (`replace === true` **ou** `rows === 0`) → seguir o fluxo atual:
    `deleteByFileName(sourceName)` e ingestão com `source_file = sourceName`.
- `GET /api/import/:id` (status do job) permanece inalterado.

### 3.3 Interface (tela Importação)

Para ambos os caminhos ("Importar" de `/cargas` e "Enviar" upload do PC):

1. Ao acionar, a UI chama `GET /api/imports/exists?file=<nome>` primeiro
   (no upload, com o nome do arquivo escolhido, **antes** de transmitir).
2. `exists === false` → segue direto (importa/envia).
3. `exists === true` → exibe aviso inline:
   *"⚠️ '<nome>' já foi importado em <lastIngestedAt> (N linhas).
   Reprocessar substituirá esses registros."* com botões
   **"Reprocessar (substituir N linhas)"** e **"Cancelar"**.
4. Só ao confirmar "Reprocessar" a UI chama import/upload com `replace=true`.
5. Um `409 already_imported` inesperado (corrida) é exibido com a mesma
   mensagem (estado de erro já existente).

`ProgressMonitor` e o polling de job permanecem como estão.

## 4. Tratamento de erros

| Situação | Resposta |
|---|---|
| `file` ausente/inválido em `exists` | `400 {error:"bad_request"}` |
| Arquivo já importado e `replace` ≠ true (`/api/import`) | `409 {error:"already_imported", rows, lastIngestedAt}` |
| Idem no `/api/upload` | `409 ...` + `unlink` do arquivo temporário |
| `replace=true` ou inexistente | fluxo normal (delete por nome original + ingest) |
| Falha de ingestão | já refletida no job (`failed`/contadores) |

## 5. Testes (TDD, execução subagent-driven)

- **Backend:**
  - `fileStats`/consulta extraída — teste puro de SQL+params (padrão
    `buildWhereClause`).
  - `GET /api/imports/exists` — repo fake: retorna `{exists,rows,lastIngestedAt}`;
    `400` para `file` vazio.
  - `POST /api/import` — `409` quando `fileStats.rows>0` e sem `replace`;
    segue (delete+ingest) quando `replace=true` ou `rows=0`.
  - `POST /api/upload` — original vira `source_file`; `409` + remoção do
    parcial quando já existe e sem `replace`; segue quando `replace=true`.
  - `startIngestJob`/`ingestCsv`/`mapRow` — `source_file` = `sourceName`
    explícito (não `basename(filePath)`); atualizar testes existentes que
    assumiam `basename` (rowMapper/ingestService/import) preservando asserções.
- **Frontend:** fluxo "exists→aviso→confirmar→replace=true" e
  "não existe→segue direto" (mock `fetch`/`XMLHttpRequest`); 409 mostra aviso.
- Suíte completa verde + builds limpos; push + redeploy; verificação real:
  reimportar `Consultaderequestsresultados635.csv` → detecta (aviso),
  confirmar substitui e o total permanece ~686.181 (não duplica).

## 6. Fora de escopo (YAGNI)

- Troca de engine para `ReplacingMergeTree` / dedupe global por `id_interno`.
- Substituição **atômica** (eliminar a janela ~2 min em que os dados do
  arquivo somem durante apaga+reinsere) — feature futura separada.
- Migração de `source_file` já gravados (ex.: `smoke-...-hex.csv`). Registros
  existentes ficam como estão; novas importações usam o nome original. O
  arquivo grande já está como `Consultaderequestsresultados635.csv`, então seu
  reprocessamento já é corretamente identificado.
- Histórico/auditoria de importações além de `count`/`max(ingested_at)`.
