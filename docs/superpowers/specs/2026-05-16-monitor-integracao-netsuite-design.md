# Monitor de Integração NetSuite — Design

Data: 2026-05-16

## 1. Objetivo

Aplicação web independente para monitorar requests de integração do NetSuite a
partir dos arquivos CSV depositados no diretório `/cargas`. Permite:

- Ver volume e timeline de requests (por período, tipo de script, título).
- Buscar e fazer drill-down no payload JSON (`Detalhes`).
- Rastrear o ciclo de uma transação por `txn_id` / `integra_id`.
- Visualizar status sucesso/erro (regra de classificação **a definir depois**;
  por enquanto `status = 'unknown'`).

A importação dos arquivos é **manual via UI**.

## 2. Restrições e contexto

- Servidor de aplicação Docker: **192.168.56.113** (porta frontend `8090`,
  API `8091`).
- ClickHouse: **já existente e rodando** em **192.168.56.127**
  (usuário `wagner`, senha `123`). Não provisionamos o ClickHouse — apenas
  criamos database/tabelas e conectamos.
- O projeto **R2P** já roda em 192.168.56.113. Este projeto é totalmente
  separado, em containers próprios, com portas dedicadas, sem conflitar com o
  R2P.
- O diretório `/cargas` e o CSV de ~1.2 GB
  (`Consultaderequestsresultados635.csv`) estão **nesta máquina local**.
  A ingestão roda localmente contra o ClickHouse remoto. O mesmo
  `docker-compose` serve para deploy posterior em 192.168.56.113 (apenas troca
  do bind do volume `/cargas`).
- Credenciais e IPs em `.env` (não commitado); `.env.example` versionado.
- Usar as **versões estáveis mais recentes** de todos os pacotes (React 19,
  Vite, Fastify 5, `@clickhouse/client`, Recharts, Tailwind, TypeScript 5.x),
  com versões exatas fixadas via `package-lock.json` na implementação.

## 3. Arquitetura

Três serviços (ClickHouse externo), orquestrados por `docker-compose`:

| Serviço | Tecnologia | Porta | Função |
|---|---|---|---|
| `monitor-web` | React 19 + Vite + TypeScript + Tailwind (Nginx em prod) | 8090 (host) | Dashboard |
| `monitor-api` | Node.js + Fastify 5 + TypeScript | 8091 | API REST, ingestão CSV, queries ClickHouse |
| ClickHouse | Existente | 8123/9000 | Armazenamento (externo, não gerenciado por nós) |

Fluxo: `CSV em ./cargas` → importação manual via UI dispara →
`monitor-api` faz streaming do CSV → insere em lote no ClickHouse remoto →
`monitor-web` consulta a API para dashboards, busca e drill-down.

## 4. Modelo de dados

Tabela `monitor.requests`, engine `MergeTree`, particionada por mês,
`ORDER BY (event_ts, id_interno)`.

| Coluna | Tipo | Origem |
|---|---|---|
| `id_interno` | `UInt64` | "ID interno" |
| `event_ts` | `DateTime` | "Data" (`dd/MM/yyyy`) + "Hora" (`H:mm`) combinados |
| `nome` | `LowCardinality(String)` | "Nome" |
| `titulo` | `LowCardinality(String)` | "Título" (ex.: `nr`, `pymtChargeback`) |
| `tipo` | `LowCardinality(String)` | "Tipo" (ex.: `Depurar`) |
| `tipo_script` | `LowCardinality(String)` | "Tipo de script" |
| `detalhes` | `String` | JSON bruto "Detalhes" |
| `txn_id` | `String` | `detalhes.id` |
| `txn_type` | `LowCardinality(String)` | `detalhes.type` (ex.: `invoice`) |
| `integra_id` | `String` | `detalhes.fields.custbody_nst_integra_id_` |
| `status` | `LowCardinality(String)` | `'unknown'` (regra configurável depois) |
| `ingest_batch` | `UUID` | id do lote de importação |
| `ingested_at` | `DateTime` | timestamp da ingestão |

Campos derivados do JSON são extraídos na ingestão para busca rápida; o JSON
completo permanece em `detalhes` para drill-down. Linhas com `detalhes` vazio
(ex.: `pymtChargeback`) são ingeridas sem extração de JSON.

## 5. Ingestão (`monitor-api`)

- Streaming linha-a-linha do CSV respeitando aspas, JSON multilinha e `""`
  escapados. Nunca carrega os 1.2 GB em memória.
- Inserção em lotes (~50k linhas) via `@clickhouse/client`.
- Idempotência: cada importação gera `ingest_batch`. Reimportar o mesmo
  arquivo **substitui** os dados desse arquivo (default).
- `POST /api/import` retorna `jobId`; progresso via `GET /api/import/:jobId`
  (linhas processadas, erros de parse, status: `running|done|failed`).
- Erros de parse por linha são contabilizados e logados (com nº da linha) sem
  abortar o job; resumo no fim. Falha de conexão ClickHouse → job `failed`.

## 6. API

| Método | Rota | Função |
|---|---|---|
| POST | `/api/import` | Dispara importação do arquivo escolhido → `jobId` |
| GET | `/api/import/:jobId` | Progresso/erros do job |
| GET | `/api/files` | Lista CSVs em `/cargas` (nome, tamanho, data) |
| GET | `/api/stats` | Agregações para timeline/volume (hora/dia, tipo_script, titulo) |
| GET | `/api/requests` | Lista paginada com filtros (data, tipo, título, status, texto) |
| GET | `/api/requests/:id` | Payload JSON completo (drill-down) |
| GET | `/api/transactions/:txnId` | Eventos de uma transação (`txn_id`/`integra_id`) |
| GET | `/api/health` | Healthcheck (API + conexão ClickHouse) |

Respostas de erro padronizadas `{ error, message }`, códigos `4xx`/`5xx`
apropriados, com timeout/retry na conexão ClickHouse.

## 7. Frontend (`monitor-web`)

SPA React com 4 áreas:

1. **Dashboard**: cards de totais + gráficos de volume/timeline (Recharts).
2. **Requests**: tabela paginada com filtros (intervalo de data, tipo, título,
   status, busca textual em `integra_id`/`txn_id`/placa/chassi). Clique abre
   drill-down com JSON formatado.
3. **Transação**: timeline dos eventos relacionados a uma transação.
4. **Importação**: lista arquivos de `/cargas`, botão "Importar", barra de
   progresso do job.

Estilo limpo com Tailwind CSS. Rótulos em PT-BR. Estados de
loading/erro/vazio em cada tela. **Sem autenticação** nesta fase (rede
interna); reavaliar depois.

## 8. Testes

- `monitor-api`: testes unitários do parser CSV (aspas, JSON multilinha, `""`
  escapado, linha sem `detalhes`), da extração de campos do JSON e do
  conversor de data BR → `DateTime`. Teste de integração da ingestão com um
  CSV pequeno de fixture (não o de 1.2 GB).
- `monitor-web`: testes de componente das telas principais (render, filtros,
  estados de erro).
- Desenvolvimento orientado a testes (TDD) na implementação.

## 9. Estrutura do projeto (monorepo)

```
WebhoohMonitor/
├─ apps/
│  ├─ api/        # Fastify + ingestão + ClickHouse client
│  └─ web/        # React + Vite
├─ cargas/        # CSVs (volume montado; arquivos grandes no .gitignore)
├─ docker-compose.yml
├─ .env.example
└─ docs/superpowers/specs/
```

O arquivo `cargas/Consultaderequestsresultados635.csv` (1.2 GB) entra no
`.gitignore` — não vai para o git.

## 10. Itens adiados (fora de escopo nesta fase)

- Regra de classificação de status sucesso/erro (modelado como `unknown`).
- Watcher contínuo de novos arquivos (importação é manual).
- Autenticação/autorização.
- Script automatizado de deploy via SSH para 192.168.56.113.
- Provisionamento do ClickHouse (já existe).
