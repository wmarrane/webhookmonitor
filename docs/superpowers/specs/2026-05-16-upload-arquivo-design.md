# Upload de Arquivo do Navegador → ClickHouse — Design

Data: 2026-05-16

## 1. Objetivo

Permitir que o usuário **selecione um arquivo CSV do próprio computador** na
tela de Importação e o envie ao servidor para ser ingerido no ClickHouse,
reutilizando o pipeline de ingestão existente. Hoje a importação só lista
arquivos já presentes em `/cargas` (lado servidor); esta feature adiciona o
envio a partir da máquina do usuário.

## 2. Restrições e contexto

- Stack já implantada em `192.168.56.113` (backend Fastify `:8091`, frontend
  React `:8090`, isolada do R2P). ClickHouse em `192.168.56.127` (usuário
  `wagner`).
- O volume `./cargas:/cargas:ro` é **read-only** — uploads NÃO podem ser
  gravados ali. Será usado um novo volume **gravável** `./uploads:/uploads`.
- Arquivos podem ser grandes (1 GB+, ex.: o CSV real de ~1.2 GB) → o upload
  deve ser gravado em **streaming direto para disco**, sem bufferizar em
  memória. **Sem limite de tamanho** (decisão do usuário).
- Reutilizar o pipeline atual: `RequestsRepo.deleteByFileName`,
  `ingestCsv` (streaming), `JobStore` e a rota de progresso
  `GET /api/import/:id`.
- Sem autenticação (rede interna), consistente com o resto do sistema.

## 3. Arquitetura

Abordagem A — upload multipart em streaming → disco → ingestão existente.

Fluxo:
`<input type=file>` no navegador → `POST /api/upload` (multipart) →
backend grava o stream em `UPLOAD_DIR` (disco, RW) → ao concluir, dispara
`deleteByFileName(nome)` + `ingestCsv(path)` com `JobStore` → responde
`{ jobId }` → frontend acompanha via `GET /api/import/:id` (painel de job já
existente).

### Backend (`backend/`)

- Dependência nova: `@fastify/multipart` (versão estável mais recente, fixada
  no implementação).
- `src/config.ts`: adicionar `UPLOAD_DIR` (default `/uploads`) e
  `MAX_UPLOAD_BYTES` (default `0` = ilimitado; >0 aplica limite).
- `src/routes/upload.ts`: `registerUpload(app, deps)`.
  - `POST /api/upload`: lê **uma** part de arquivo via API de streaming do
    `@fastify/multipart` (`request.file()`), valida que o nome termina em
    `.csv` (case-insensitive) → senão `400 {error,message}`.
  - Sanitiza o nome com `basename()` e gera um nome único
    `${base}-${timestamp}.csv` gravado em `UPLOAD_DIR` via
    `pipeline(part.file, createWriteStream(dest))` (streaming, sem memória).
  - Se `MAX_UPLOAD_BYTES > 0`, configura o limite do multipart; estouro →
    `413 {error,message}` e remove o arquivo parcial.
  - Em erro de I/O / abort do cliente → remove o arquivo parcial e responde
    `5xx/4xx {error,message}`.
  - Sucesso: cria job no `JobStore`, responde `202 { jobId }`, e dispara
    de forma assíncrona (mesmo padrão de `routes/import.ts`):
    `deleteByFileName(nomeUnico)` → `ingestCsv({ filePath, ingestBatch,
    batchSize, insert: repo.insertRows, onProgress, onError })` →
    `jobs.update(result)` → `finish("done")`; se `rowsInserted===0 &&
    rowsProcessed>0` → `finish("failed", primeiroErro)`; exceção dura →
    `finish("failed", msg)`.
- `src/index.ts`: registrar `@fastify/multipart` e `registerUpload` no
  `registerExtra`, injetando `{ cfg, repo, jobs }` (igual a `registerImport`).
  O arquivo enviado **permanece** em `UPLOAD_DIR` (auditoria/reimport).

### Frontend (`frontend/`)

- `src/api/client.ts`: adicionar `uploadFile(file: File, onProgress)` usando
  `XMLHttpRequest` (necessário para evento de progresso de upload), `POST`
  multipart para `${BASE}/api/upload`, resolvendo `{ jobId }`.
- `src/pages/Import.tsx`: nova seção "Enviar arquivo do meu computador" com
  `<input type="file" accept=".csv">` + botão **Enviar**. Mostra barra de
  progresso do **upload** (0–100%); ao receber `jobId`, reaproveita o painel
  de job existente (polling de `importStatus`) para a fase de ingestão.
  Estados de erro/loading reutilizam o padrão atual (`setError`).

### Infra

- `docker-compose.yml` (serviço `monitor-api`): adicionar volume
  `./uploads:/uploads` (RW) e envs `UPLOAD_DIR=/uploads`,
  `MAX_UPLOAD_BYTES=0`. `/cargas` continua `:ro`. Portas e isolamento do R2P
  inalterados. `.env.example` documenta as duas novas variáveis.
- `.gitignore`: ignorar `uploads/*` (manter `uploads/.gitkeep`).

## 4. Tratamento de erros

| Situação | Resposta |
|---|---|
| Arquivo não-`.csv` | `400 {error:"bad_request",message}` |
| Sem part de arquivo no multipart | `400 {error:"bad_request",message}` |
| Excede `MAX_UPLOAD_BYTES` (quando >0) | `413 {error:"too_large",message}` + remove parcial |
| Erro de I/O ao gravar / abort do cliente | remove parcial; `500/400 {error,message}` |
| Falha de ingestão (ex.: ClickHouse) | já refletida no job (`failed`/contadores) |

O job de ingestão segue a semântica já existente (parse vs insert errors,
`failed` se nada inserido).

## 5. Testes (TDD, execução subagent-driven)

- **Backend** (`backend/tests/upload.test.ts`): via `app.inject` com payload
  multipart —
  - upload de um CSV pequeno (fixture) grava em dir temporário e dispara o
    ingest (repo fake), job chega a `done` com linhas inseridas;
  - nome não-`.csv` → 400;
  - quando `MAX_UPLOAD_BYTES` pequeno e arquivo maior → 413 e arquivo parcial
    removido;
  - sanitização: nome com `../` é neutralizado (gravado só dentro de
    `UPLOAD_DIR`).
- **Frontend** (`frontend/src/pages/Import.test.tsx` — caso novo OU teste do
  cliente): seleção de arquivo + envio mockando `XMLHttpRequest`/`fetch`,
  verifica progresso de upload e transição para o painel de job (`done`).
- Suíte completa permanece verde (backend + frontend) e build limpo.

## 6. Fora de escopo (YAGNI)

- Upload chunked/resumável (tus/uppy).
- Parsear o stream do upload direto no ClickHouse sem persistir em disco.
- Múltiplos arquivos por requisição.
- Autenticação/limitação por usuário.
- Listar arquivos de `/uploads` na UI (o rastreio se dá por `source_file` no
  ClickHouse; reimport manual é possível copiando para `/cargas` se desejado).
