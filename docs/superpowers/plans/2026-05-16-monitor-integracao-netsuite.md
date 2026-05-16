# Monitor de Integração NetSuite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, containerized web app that ingests NetSuite integration-request CSV files from `/cargas` into an existing remote ClickHouse and lets users explore volume/timeline, search and drill into payloads, and trace transactions.

**Architecture:** npm-workspaces monorepo. `apps/api` is a Fastify 5 / TypeScript service that streams the CSV (never loading the 1.2 GB file into memory), maps rows, and batch-inserts into ClickHouse at 192.168.56.127; it also serves query endpoints. `apps/web` is a React 19 + Vite SPA (served by Nginx in prod) that consumes the API. Both run in their own Docker containers via `docker-compose`, on dedicated high ports (web 8090, api 8091), fully separate from the R2P project. ClickHouse already exists and is not provisioned by us.

**Tech Stack:** Node 22, TypeScript 6, Fastify 5.8, @clickhouse/client 1.18, csv-parse 6, zod 4, pino 10, Vitest 4, React 19.2, Vite 8, react-router-dom 7, Recharts 3, Tailwind CSS 4 (`@tailwindcss/vite`), Docker Compose.

**Pinned versions (exact):** react 19.2.6, react-dom 19.2.6, @types/react 19.2.14, @types/react-dom 19.2.3, vite 8.0.13, @vitejs/plugin-react 6.0.2, react-router-dom 7.15.1, recharts 3.8.1, tailwindcss 4.3.0, @tailwindcss/vite 4.3.0, typescript 6.0.3, vitest 4.1.6, @testing-library/react 16.3.2, @testing-library/jest-dom 6.9.1, @testing-library/user-event 14.6.1, jsdom 29.1.1, fastify 5.8.5, @fastify/cors 11.2.0, @fastify/sensible 6.0.4, fastify-plugin 5.1.0, @clickhouse/client 1.18.5, csv-parse 6.2.1, zod 4.4.3, pino 10.3.1, pino-pretty (latest at install), tsx 4.22.0, @types/node 25.8.0.

**Conventions:** TDD throughout — write the failing test, run it red, implement minimally, run it green, commit. Exact Windows absolute paths in all file operations. Commit messages end with the Co-Authored-By trailer below.

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## File Structure

```
WebhoohMonitor/
├─ package.json                      # root: npm workspaces, shared scripts
├─ .gitignore                        # add cargas/*.csv
├─ .env.example                      # documented env template
├─ docker-compose.yml                # api + web services
├─ apps/
│  ├─ api/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  ├─ vitest.config.ts
│  │  ├─ Dockerfile
│  │  ├─ .dockerignore
│  │  ├─ src/
│  │  │  ├─ index.ts                 # bootstrap: load config, build server, listen
│  │  │  ├─ server.ts                # Fastify app factory (plugins + routes)
│  │  │  ├─ config.ts                # env parsing via zod
│  │  │  ├─ clickhouse.ts            # ClickHouse client factory + schema init
│  │  │  ├─ types.ts                 # shared row/DTO types
│  │  │  ├─ csv/
│  │  │  │  ├─ parseDateBR.ts        # "dd/MM/yyyy" + "H:mm" -> Date
│  │  │  │  ├─ extractFields.ts      # pull txn_id/txn_type/integra_id from Detalhes JSON
│  │  │  │  └─ rowMapper.ts          # CSV record -> RequestRow
│  │  │  ├─ ingest/
│  │  │  │  ├─ jobStore.ts           # in-memory import-job registry
│  │  │  │  └─ ingestService.ts      # stream CSV -> batched ClickHouse insert
│  │  │  ├─ repo/
│  │  │  │  └─ requestsRepo.ts       # stats/list/byId/byTxn queries
│  │  │  └─ routes/
│  │  │     ├─ health.ts
│  │  │     ├─ files.ts
│  │  │     ├─ import.ts
│  │  │     ├─ requests.ts
│  │  │     └─ transactions.ts
│  │  └─ tests/
│  │     ├─ parseDateBR.test.ts
│  │     ├─ extractFields.test.ts
│  │     ├─ rowMapper.test.ts
│  │     ├─ ingestService.test.ts
│  │     └─ fixtures/sample.csv
│  └─ web/
│     ├─ package.json
│     ├─ tsconfig.json
│     ├─ tsconfig.node.json
│     ├─ vite.config.ts
│     ├─ vitest.config.ts
│     ├─ vitest.setup.ts
│     ├─ Dockerfile
│     ├─ .dockerignore
│     ├─ nginx.conf
│     ├─ index.html
│     └─ src/
│        ├─ main.tsx
│        ├─ App.tsx                   # router + layout shell
│        ├─ index.css                 # tailwind entry
│        ├─ api/client.ts             # typed fetch wrapper + DTOs
│        ├─ components/
│        │  ├─ Layout.tsx
│        │  ├─ AsyncState.tsx         # loading/error/empty wrapper
│        │  └─ JsonViewer.tsx
│        └─ pages/
│           ├─ Dashboard.tsx
│           ├─ Requests.tsx
│           ├─ Transaction.tsx
│           └─ Import.tsx
└─ cargas/                            # CSVs (volume-mounted; *.csv gitignored)
```

---

## Phase 0 — Repo hygiene & workspace scaffold

### Task 0.1: Untrack the 1.2 GB CSV and fix .gitignore

**Files:**
- Modify: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\.gitignore`

- [ ] **Step 1: Inspect current .gitignore**

Run: `git ls-files cargas/`
Expected: shows `cargas/Consultaderequestsresultados635.csv` is tracked (committed in root commit).

- [ ] **Step 2: Append ignore rules**

Append to `.gitignore`:

```
# Large data files — never commit
cargas/*.csv
!cargas/.gitkeep

# Node
node_modules/
dist/
.env
*.log

# Build
apps/*/dist/
```

- [ ] **Step 3: Untrack the large CSV (keep the file on disk)**

Run:
```
git rm --cached "cargas/Consultaderequestsresultados635.csv"
git add cargas/.gitkeep 2>$null; New-Item -ItemType File -Force cargas/.gitkeep | Out-Null
git add .gitignore cargas/.gitkeep
git commit -m "chore: stop tracking large CSV; add .gitignore`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
Expected: commit succeeds; `git ls-files cargas/` now shows only `cargas/.gitkeep`.

> Note: the file still exists in the prior root commit's history. There is no remote yet, so history is local-only. Rewriting the root commit to purge it is OPTIONAL and out of scope unless the user later asks; flag it but do not perform it automatically.

### Task 0.2: Root workspace package.json

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\package.json` (overwrites the existing stub)

- [ ] **Step 1: Write root package.json**

```json
{
  "name": "webhook-monitor",
  "version": "1.0.0",
  "private": true,
  "workspaces": ["apps/api", "apps/web"],
  "scripts": {
    "dev:api": "npm run dev --workspace apps/api",
    "dev:web": "npm run dev --workspace apps/web",
    "test": "npm run test --workspace apps/api && npm run test --workspace apps/web",
    "build": "npm run build --workspace apps/api && npm run build --workspace apps/web"
  }
}
```

- [ ] **Step 2: Remove obsolete stub files**

Run:
```
git rm src/index.ts tsconfig.json
```
Expected: the old single-file stub is removed (its functionality is replaced by the monorepo).

- [ ] **Step 3: Commit**

```
git add package.json
git commit -m "chore: convert repo to npm-workspaces monorepo`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 0.3: .env.example

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\.env.example`

- [ ] **Step 1: Write .env.example**

```
# ClickHouse (existing server — do not provision)
CLICKHOUSE_URL=http://192.168.56.127:8123
CLICKHOUSE_USER=wagner
CLICKHOUSE_PASSWORD=123
CLICKHOUSE_DB=monitor

# API
API_PORT=8091
# Directory mounted into the api container that holds the CSV files
CARGAS_DIR=/cargas
# Rows per ClickHouse insert batch
INGEST_BATCH_SIZE=50000
LOG_LEVEL=info

# Web (build-time): base URL the browser uses to reach the API
VITE_API_BASE_URL=http://192.168.56.113:8091
```

- [ ] **Step 2: Commit**

```
git add .env.example
git commit -m "chore: add env template`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1 — API: project setup

### Task 1.1: API package.json, tsconfig, vitest config

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\package.json`
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\tsconfig.json`
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\vitest.config.ts`

- [ ] **Step 1: Write apps/api/package.json**

```json
{
  "name": "@monitor/api",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@clickhouse/client": "1.18.5",
    "@fastify/cors": "11.2.0",
    "@fastify/sensible": "6.0.4",
    "csv-parse": "6.2.1",
    "fastify": "5.8.5",
    "fastify-plugin": "5.1.0",
    "pino": "10.3.1",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@types/node": "25.8.0",
    "pino-pretty": "latest",
    "tsx": "4.22.0",
    "typescript": "6.0.3",
    "vitest": "4.1.6"
  }
}
```

- [ ] **Step 2: Write apps/api/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write apps/api/vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Install dependencies**

Run (from repo root): `npm install`
Expected: installs workspaces; `apps/api/node_modules` populated, no errors.

- [ ] **Step 5: Commit**

```
git add apps/api/package.json apps/api/tsconfig.json apps/api/vitest.config.ts package-lock.json
git commit -m "chore(api): scaffold Fastify/TS project`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.2: Shared types and config

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\src\types.ts`
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\src\config.ts`

- [ ] **Step 1: Write src/types.ts**

```ts
export interface RequestRow {
  id_interno: number;
  event_ts: string;        // "YYYY-MM-DD HH:MM:SS" (ClickHouse DateTime)
  nome: string;
  titulo: string;
  tipo: string;
  tipo_script: string;
  detalhes: string;        // raw JSON string (may be empty)
  txn_id: string;
  txn_type: string;
  integra_id: string;
  status: string;          // 'unknown' for now
  ingest_batch: string;    // UUID
  ingested_at: string;     // "YYYY-MM-DD HH:MM:SS"
}

export interface ImportJob {
  id: string;
  file: string;
  status: "running" | "done" | "failed";
  rowsProcessed: number;
  rowsInserted: number;
  parseErrors: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}
```

- [ ] **Step 2: Write src/config.ts**

```ts
import { z } from "zod";

const schema = z.object({
  CLICKHOUSE_URL: z.string().url(),
  CLICKHOUSE_USER: z.string().min(1),
  CLICKHOUSE_PASSWORD: z.string(),
  CLICKHOUSE_DB: z.string().min(1).default("monitor"),
  API_PORT: z.coerce.number().int().positive().default(8091),
  CARGAS_DIR: z.string().min(1).default("/cargas"),
  INGEST_BATCH_SIZE: z.coerce.number().int().positive().default(50000),
  LOG_LEVEL: z.string().default("info"),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      "Invalid environment configuration: " +
        JSON.stringify(parsed.error.flatten().fieldErrors),
    );
  }
  return parsed.data;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build --workspace apps/api`
Expected: compiles with no errors (produces `apps/api/dist`).

- [ ] **Step 4: Commit**

```
git add apps/api/src/types.ts apps/api/src/config.ts
git commit -m "feat(api): config loader and shared types`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — API: CSV parsing logic (pure, unit-tested)

### Task 2.1: BR date/time parser

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\src\csv\parseDateBR.ts`
- Test: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\tests\parseDateBR.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseDateBR } from "../src/csv/parseDateBR.js";

describe("parseDateBR", () => {
  it("combines dd/MM/yyyy and H:mm into ClickHouse DateTime", () => {
    expect(parseDateBR("15/05/2026", "1:06")).toBe("2026-05-15 01:06:00");
  });

  it("zero-pads two-digit hours and minutes", () => {
    expect(parseDateBR("01/12/2025", "23:09")).toBe("2025-12-01 23:09:00");
  });

  it("returns epoch-zero string for empty/invalid input", () => {
    expect(parseDateBR("", "")).toBe("1970-01-01 00:00:00");
    expect(parseDateBR("bad", "x")).toBe("1970-01-01 00:00:00");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/api -- parseDateBR`
Expected: FAIL — cannot find module `parseDateBR.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
const FALLBACK = "1970-01-01 00:00:00";

export function parseDateBR(date: string, time: string): string {
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((date ?? "").trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec((time ?? "").trim());
  if (!d || !t) return FALLBACK;
  const [, dd, mm, yyyy] = d;
  const hh = t[1].padStart(2, "0");
  const min = t[2];
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:00`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace apps/api -- parseDateBR`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```
git add apps/api/src/csv/parseDateBR.ts apps/api/tests/parseDateBR.test.ts
git commit -m "feat(api): BR date parser`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.2: JSON field extractor

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\src\csv\extractFields.ts`
- Test: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\tests\extractFields.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { extractFields } from "../src/csv/extractFields.js";

describe("extractFields", () => {
  it("extracts id, type and integra_id from a valid payload", () => {
    const json = JSON.stringify({
      id: "360738",
      type: "invoice",
      fields: { custbody_nst_integra_id_: "38967664" },
    });
    expect(extractFields(json)).toEqual({
      txn_id: "360738",
      txn_type: "invoice",
      integra_id: "38967664",
    });
  });

  it("returns empty strings for empty detalhes", () => {
    expect(extractFields("")).toEqual({
      txn_id: "",
      txn_type: "",
      integra_id: "",
    });
  });

  it("returns empty strings for invalid JSON without throwing", () => {
    expect(extractFields("{not json")).toEqual({
      txn_id: "",
      txn_type: "",
      integra_id: "",
    });
  });

  it("tolerates missing fields object", () => {
    expect(extractFields(JSON.stringify({ id: "9", type: "x" }))).toEqual({
      txn_id: "9",
      txn_type: "x",
      integra_id: "",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/api -- extractFields`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface ExtractedFields {
  txn_id: string;
  txn_type: string;
  integra_id: string;
}

const EMPTY: ExtractedFields = { txn_id: "", txn_type: "", integra_id: "" };

export function extractFields(detalhes: string): ExtractedFields {
  const raw = (detalhes ?? "").trim();
  if (!raw) return { ...EMPTY };
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const fields = (obj.fields ?? {}) as Record<string, unknown>;
    return {
      txn_id: str(obj.id),
      txn_type: str(obj.type),
      integra_id: str(fields.custbody_nst_integra_id_),
    };
  } catch {
    return { ...EMPTY };
  }
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace apps/api -- extractFields`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```
git add apps/api/src/csv/extractFields.ts apps/api/tests/extractFields.test.ts
git commit -m "feat(api): JSON field extractor`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.3: Row mapper (CSV record -> RequestRow)

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\src\csv\rowMapper.ts`
- Test: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\tests\rowMapper.test.ts`

The CSV header is exactly: `ID interno,Data,Hora,Nome,Título,Tipo,Tipo de script,Detalhes`. `csv-parse` with `columns: true` yields objects keyed by those header names.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mapRow } from "../src/csv/rowMapper.js";

const rec = {
  "ID interno": "3262308",
  Data: "15/05/2026",
  Hora: "1:06",
  Nome: "[CCC] MSG Transaction UE",
  "Título": "nr",
  Tipo: "Depurar",
  "Tipo de script": "Evento de usuário",
  Detalhes: JSON.stringify({
    id: "360738",
    type: "invoice",
    fields: { custbody_nst_integra_id_: "38967664" },
  }),
};

describe("mapRow", () => {
  it("maps a full record into a RequestRow", () => {
    const row = mapRow(rec, "batch-1", "2026-05-16 10:00:00");
    expect(row.id_interno).toBe(3262308);
    expect(row.event_ts).toBe("2026-05-15 01:06:00");
    expect(row.nome).toBe("[CCC] MSG Transaction UE");
    expect(row.titulo).toBe("nr");
    expect(row.tipo).toBe("Depurar");
    expect(row.tipo_script).toBe("Evento de usuário");
    expect(row.txn_id).toBe("360738");
    expect(row.txn_type).toBe("invoice");
    expect(row.integra_id).toBe("38967664");
    expect(row.status).toBe("unknown");
    expect(row.ingest_batch).toBe("batch-1");
    expect(row.ingested_at).toBe("2026-05-16 10:00:00");
  });

  it("handles empty Detalhes (e.g. pymtChargeback rows)", () => {
    const row = mapRow(
      { ...rec, "Título": "pymtChargeback", Detalhes: "" },
      "b",
      "2026-05-16 10:00:00",
    );
    expect(row.detalhes).toBe("");
    expect(row.txn_id).toBe("");
    expect(row.integra_id).toBe("");
  });

  it("defaults id_interno to 0 when not numeric", () => {
    const row = mapRow({ ...rec, "ID interno": "" }, "b", "2026-05-16 10:00:00");
    expect(row.id_interno).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/api -- rowMapper`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { RequestRow } from "../types.js";
import { parseDateBR } from "./parseDateBR.js";
import { extractFields } from "./extractFields.js";

export type CsvRecord = Record<string, string | undefined>;

export function mapRow(
  rec: CsvRecord,
  ingestBatch: string,
  ingestedAt: string,
): RequestRow {
  const detalhes = rec["Detalhes"] ?? "";
  const f = extractFields(detalhes);
  const idNum = Number.parseInt((rec["ID interno"] ?? "").trim(), 10);
  return {
    id_interno: Number.isFinite(idNum) ? idNum : 0,
    event_ts: parseDateBR(rec["Data"] ?? "", rec["Hora"] ?? ""),
    nome: (rec["Nome"] ?? "").trim(),
    titulo: (rec["Título"] ?? "").trim(),
    tipo: (rec["Tipo"] ?? "").trim(),
    tipo_script: (rec["Tipo de script"] ?? "").trim(),
    detalhes,
    txn_id: f.txn_id,
    txn_type: f.txn_type,
    integra_id: f.integra_id,
    status: "unknown",
    ingest_batch: ingestBatch,
    ingested_at: ingestedAt,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace apps/api -- rowMapper`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```
git add apps/api/src/csv/rowMapper.ts apps/api/tests/rowMapper.test.ts
git commit -m "feat(api): CSV row mapper`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — API: ClickHouse client & schema

### Task 3.1: ClickHouse client factory + schema init

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\src\clickhouse.ts`

No unit test (requires a live server). Verified manually in Step 3 and exercised by route/integration use.

- [ ] **Step 1: Write src/clickhouse.ts**

```ts
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { AppConfig } from "./config.js";

export function makeClickHouse(cfg: AppConfig): ClickHouseClient {
  return createClient({
    url: cfg.CLICKHOUSE_URL,
    username: cfg.CLICKHOUSE_USER,
    password: cfg.CLICKHOUSE_PASSWORD,
    database: cfg.CLICKHOUSE_DB,
    clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
  });
}

export async function initSchema(
  client: ClickHouseClient,
  db: string,
): Promise<void> {
  await client.command({ query: `CREATE DATABASE IF NOT EXISTS ${db}` });
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${db}.requests (
        id_interno    UInt64,
        event_ts      DateTime,
        nome          LowCardinality(String),
        titulo        LowCardinality(String),
        tipo          LowCardinality(String),
        tipo_script   LowCardinality(String),
        detalhes      String,
        txn_id        String,
        txn_type      LowCardinality(String),
        integra_id    String,
        status        LowCardinality(String),
        ingest_batch  UUID,
        ingested_at   DateTime
      )
      ENGINE = MergeTree
      PARTITION BY toYYYYMM(event_ts)
      ORDER BY (event_ts, id_interno)
    `,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build --workspace apps/api`
Expected: compiles cleanly.

- [ ] **Step 3: Manual connectivity check (requires reachable ClickHouse)**

Create a temp env and run a one-off check from `apps/api`:
```
$env:CLICKHOUSE_URL="http://192.168.56.127:8123"; $env:CLICKHOUSE_USER="wagner"; $env:CLICKHOUSE_PASSWORD="123"; $env:CLICKHOUSE_DB="monitor"
npx tsx -e "import {makeClickHouse,initSchema} from './src/clickhouse.ts'; import {loadConfig} from './src/config.ts'; const c=makeClickHouse(loadConfig()); await initSchema(c,'monitor'); const r=await c.query({query:'SELECT 1 AS ok',format:'JSON'}); console.log(await r.json()); await c.close();"
```
Expected: prints `{ ... data: [ { ok: 1 } ] ... }`. If the host is unreachable from the dev machine, document that and defer this check to deployment (the code still compiles and is exercised by Task 4.x integration test against a fixture).

- [ ] **Step 4: Commit**

```
git add apps/api/src/clickhouse.ts
git commit -m "feat(api): ClickHouse client + schema init`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — API: ingestion service

### Task 4.1: In-memory job store

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\src\ingest\jobStore.ts`
- Test: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\tests\jobStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { JobStore } from "../src/ingest/jobStore.js";

describe("JobStore", () => {
  it("creates a running job with a uuid id", () => {
    const s = new JobStore();
    const job = s.create("file.csv");
    expect(job.status).toBe("running");
    expect(job.file).toBe("file.csv");
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.get(job.id)).toEqual(job);
  });

  it("updates progress and finalizes", () => {
    const s = new JobStore();
    const job = s.create("f.csv");
    s.update(job.id, { rowsProcessed: 10, rowsInserted: 9, parseErrors: 1 });
    s.finish(job.id, "done");
    const got = s.get(job.id)!;
    expect(got.rowsProcessed).toBe(10);
    expect(got.status).toBe("done");
    expect(got.finishedAt).not.toBeNull();
  });

  it("returns undefined for unknown id", () => {
    expect(new JobStore().get("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/api -- jobStore`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { randomUUID } from "node:crypto";
import type { ImportJob } from "../types.js";

function now(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export class JobStore {
  private jobs = new Map<string, ImportJob>();

  create(file: string): ImportJob {
    const job: ImportJob = {
      id: randomUUID(),
      file,
      status: "running",
      rowsProcessed: 0,
      rowsInserted: 0,
      parseErrors: 0,
      error: null,
      startedAt: now(),
      finishedAt: null,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): ImportJob | undefined {
    return this.jobs.get(id);
  }

  update(id: string, patch: Partial<ImportJob>): void {
    const job = this.jobs.get(id);
    if (job) Object.assign(job, patch);
  }

  finish(id: string, status: "done" | "failed", error: string | null = null): void {
    const job = this.jobs.get(id);
    if (job) {
      job.status = status;
      job.error = error;
      job.finishedAt = now();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace apps/api -- jobStore`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```
git add apps/api/src/ingest/jobStore.ts apps/api/tests/jobStore.test.ts
git commit -m "feat(api): import job store`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.2: Ingestion service (streaming + batched insert)

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\src\ingest\ingestService.ts`
- Test: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\tests\ingestService.test.ts`
- Test fixture: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\tests\fixtures\sample.csv`

The service takes an *inserter* function (dependency injection) so tests verify batching/parsing without a live ClickHouse. The route layer (Task 5.4) wires the real ClickHouse inserter and the "replace data for this file" behavior.

- [ ] **Step 1: Create the fixture CSV**

Path: `apps\api\tests\fixtures\sample.csv` — exact content (note the embedded escaped-quote JSON and one empty-Detalhes row):

```
ID interno,Data,Hora,Nome,Título,Tipo,Tipo de script,Detalhes
3262308,15/05/2026,1:06,[CCC] MSG Transaction UE,nr,Depurar,Evento de usuário,"{""id"":""360738"",""type"":""invoice"",""fields"":{""custbody_nst_integra_id_"":""38967664""}}"
3266039,15/05/2026,1:08,[CCC] MSG Transaction UE,pymtChargeback,Depurar,Evento de usuário,
3246224,15/05/2026,0:25,[CCC] MSG Transaction UE,nr,Depurar,Evento de usuário,"{""id"":""3341422"",""type"":""invoice"",""fields"":{""custbody_nst_integra_id_"":""40573109""}}"
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ingestCsv } from "../src/ingest/ingestService.js";
import type { RequestRow } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const sample = join(here, "fixtures", "sample.csv");

describe("ingestCsv", () => {
  it("streams the CSV, maps rows, and batches inserts", async () => {
    const batches: RequestRow[][] = [];
    const res = await ingestCsv({
      filePath: sample,
      ingestBatch: "batch-xyz",
      batchSize: 2,
      insert: async (rows) => {
        batches.push(rows.map((r) => ({ ...r })));
      },
    });

    expect(res.rowsProcessed).toBe(3);
    expect(res.rowsInserted).toBe(3);
    expect(res.parseErrors).toBe(0);
    // batchSize 2 over 3 rows => [2,1]
    expect(batches.map((b) => b.length)).toEqual([2, 1]);

    const all = batches.flat();
    expect(all[0].txn_id).toBe("360738");
    expect(all[0].integra_id).toBe("38967664");
    expect(all[1].titulo).toBe("pymtChargeback");
    expect(all[1].detalhes).toBe("");
    expect(all[1].txn_id).toBe("");
    expect(all[2].txn_id).toBe("3341422");
  });

  it("counts insert failures into parseErrors and continues", async () => {
    let calls = 0;
    const res = await ingestCsv({
      filePath: sample,
      ingestBatch: "b",
      batchSize: 1,
      insert: async () => {
        calls += 1;
        if (calls === 2) throw new Error("clickhouse down");
      },
    });
    expect(res.rowsProcessed).toBe(3);
    expect(res.rowsInserted).toBe(2);
    expect(res.parseErrors).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace apps/api -- ingestService`
Expected: FAIL — module not found.

- [ ] **Step 4: Write minimal implementation**

```ts
import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { mapRow, type CsvRecord } from "../csv/rowMapper.js";
import type { RequestRow } from "../types.js";

export interface IngestOptions {
  filePath: string;
  ingestBatch: string;
  batchSize: number;
  insert: (rows: RequestRow[]) => Promise<void>;
  onProgress?: (p: {
    rowsProcessed: number;
    rowsInserted: number;
    parseErrors: number;
  }) => void;
}

export interface IngestResult {
  rowsProcessed: number;
  rowsInserted: number;
  parseErrors: number;
}

function now(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export async function ingestCsv(opts: IngestOptions): Promise<IngestResult> {
  const ingestedAt = now();
  let rowsProcessed = 0;
  let rowsInserted = 0;
  let parseErrors = 0;
  let batch: RequestRow[] = [];

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const toInsert = batch;
    batch = [];
    try {
      await opts.insert(toInsert);
      rowsInserted += toInsert.length;
    } catch {
      parseErrors += toInsert.length;
    }
    opts.onProgress?.({ rowsProcessed, rowsInserted, parseErrors });
  };

  const parser = createReadStream(opts.filePath).pipe(
    parse({
      columns: true,
      bom: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: false,
    }),
  );

  for await (const record of parser as AsyncIterable<CsvRecord>) {
    rowsProcessed += 1;
    try {
      batch.push(mapRow(record, opts.ingestBatch, ingestedAt));
    } catch {
      parseErrors += 1;
      continue;
    }
    if (batch.length >= opts.batchSize) await flush();
  }
  await flush();

  return { rowsProcessed, rowsInserted, parseErrors };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace apps/api -- ingestService`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```
git add apps/api/src/ingest/ingestService.ts apps/api/tests/ingestService.test.ts apps/api/tests/fixtures/sample.csv
git commit -m "feat(api): streaming CSV ingestion service`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — API: Fastify server & routes

### Task 5.1: requestsRepo (ClickHouse queries)

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\src\repo\requestsRepo.ts`

No unit test (queries need a live server); exercised manually after deployment and via the route smoke check in Task 5.6.

- [ ] **Step 1: Write src/repo/requestsRepo.ts**

```ts
import type { ClickHouseClient } from "@clickhouse/client";

export interface ListFilters {
  from?: string;        // "YYYY-MM-DD"
  to?: string;          // "YYYY-MM-DD"
  tipo?: string;
  titulo?: string;
  status?: string;
  q?: string;           // free text across txn_id/integra_id/detalhes
  page: number;         // 1-based
  pageSize: number;
}

export class RequestsRepo {
  constructor(
    private client: ClickHouseClient,
    private db: string,
  ) {}

  private whereClause(f: ListFilters): { sql: string; params: Record<string, unknown> } {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (f.from) { clauses.push("event_ts >= {from:DateTime}"); params.from = `${f.from} 00:00:00`; }
    if (f.to) { clauses.push("event_ts <= {to:DateTime}"); params.to = `${f.to} 23:59:59`; }
    if (f.tipo) { clauses.push("tipo = {tipo:String}"); params.tipo = f.tipo; }
    if (f.titulo) { clauses.push("titulo = {titulo:String}"); params.titulo = f.titulo; }
    if (f.status) { clauses.push("status = {status:String}"); params.status = f.status; }
    if (f.q) {
      clauses.push(
        "(txn_id = {q:String} OR integra_id = {q:String} OR positionCaseInsensitive(detalhes, {q:String}) > 0)",
      );
      params.q = f.q;
    }
    return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
  }

  async list(f: ListFilters) {
    const { sql, params } = this.whereClause(f);
    const offset = (f.page - 1) * f.pageSize;
    const rows = await this.client.query({
      query: `
        SELECT id_interno, event_ts, nome, titulo, tipo, tipo_script,
               txn_id, txn_type, integra_id, status
        FROM ${this.db}.requests
        ${sql}
        ORDER BY event_ts DESC, id_interno DESC
        LIMIT {limit:UInt32} OFFSET {offset:UInt32}
      `,
      query_params: { ...params, limit: f.pageSize, offset },
      format: "JSON",
    });
    const total = await this.client.query({
      query: `SELECT count() AS c FROM ${this.db}.requests ${sql}`,
      query_params: params,
      format: "JSON",
    });
    const data = (await rows.json()).data as unknown[];
    const c = ((await total.json()).data as { c: string }[])[0]?.c ?? "0";
    return { data, total: Number(c), page: f.page, pageSize: f.pageSize };
  }

  async byId(id: number) {
    const r = await this.client.query({
      query: `SELECT * FROM ${this.db}.requests WHERE id_interno = {id:UInt64} LIMIT 1`,
      query_params: { id },
      format: "JSON",
    });
    return ((await r.json()).data as unknown[])[0] ?? null;
  }

  async byTxn(txn: string) {
    const r = await this.client.query({
      query: `
        SELECT id_interno, event_ts, nome, titulo, tipo, tipo_script,
               txn_id, txn_type, integra_id, status
        FROM ${this.db}.requests
        WHERE txn_id = {txn:String} OR integra_id = {txn:String}
        ORDER BY event_ts ASC, id_interno ASC
      `,
      query_params: { txn },
      format: "JSON",
    });
    return (await r.json()).data as unknown[];
  }

  async stats(f: Pick<ListFilters, "from" | "to">) {
    const { sql, params } = this.whereClause({ ...f, page: 1, pageSize: 0 });
    const byDay = await this.client.query({
      query: `
        SELECT toDate(event_ts) AS day, count() AS total
        FROM ${this.db}.requests ${sql}
        GROUP BY day ORDER BY day
      `,
      query_params: params,
      format: "JSON",
    });
    const byScript = await this.client.query({
      query: `
        SELECT tipo_script, count() AS total
        FROM ${this.db}.requests ${sql}
        GROUP BY tipo_script ORDER BY total DESC LIMIT 50
      `,
      query_params: params,
      format: "JSON",
    });
    const byTitulo = await this.client.query({
      query: `
        SELECT titulo, count() AS total
        FROM ${this.db}.requests ${sql}
        GROUP BY titulo ORDER BY total DESC LIMIT 50
      `,
      query_params: params,
      format: "JSON",
    });
    const totals = await this.client.query({
      query: `SELECT count() AS total FROM ${this.db}.requests ${sql}`,
      query_params: params,
      format: "JSON",
    });
    return {
      byDay: (await byDay.json()).data,
      byScript: (await byScript.json()).data,
      byTitulo: (await byTitulo.json()).data,
      total: Number(((await totals.json()).data as { total: string }[])[0]?.total ?? 0),
    };
  }

  async deleteByFile(file: string) {
    await this.client.command({
      query: `ALTER TABLE ${this.db}.requests DELETE WHERE ingest_batch IN (
        SELECT DISTINCT ingest_batch FROM ${this.db}.requests WHERE 0
      )`,
    });
    // file-based replace is handled at the route layer via batch tracking;
    // see Task 5.4. This method is a placeholder hook intentionally not used.
  }

  async insertRows(rows: unknown[]) {
    await this.client.insert({
      table: `${this.db}.requests`,
      values: rows,
      format: "JSONEachRow",
    });
  }
}
```

> NOTE: `deleteByFile` is intentionally inert; the implementing engineer MUST remove it during Task 5.4 if unused. File-replace is implemented in Task 5.4 by deleting prior rows for the same file name via a tracked mapping. (Self-review flags this — see Task 5.4 Step 3, which replaces this with a concrete `deleteByFileName`.)

- [ ] **Step 2: Replace the placeholder with a concrete file-replace query**

Delete the `deleteByFile` method above and add instead:

```ts
  async deleteByFileName(file: string) {
    await this.client.command({
      query: `ALTER TABLE ${this.db}.requests DELETE WHERE source_file = {file:String}`,
      query_params: { file },
    });
  }
```

And add a `source_file` column. Update `apps/api/src/clickhouse.ts` table DDL to include, after `ingested_at   DateTime`:

```
        , source_file   String
```

Update `apps/api/src/types.ts` `RequestRow` to add `source_file: string;` and `apps/api/src/csv/rowMapper.ts` signature to accept and set it:

```ts
export function mapRow(
  rec: CsvRecord,
  ingestBatch: string,
  ingestedAt: string,
  sourceFile: string,
): RequestRow {
```
add `source_file: sourceFile,` to the returned object, and update `ingestService.ts` `mapRow(record, opts.ingestBatch, ingestedAt)` call to `mapRow(record, opts.ingestBatch, ingestedAt, basename(opts.filePath))` (import `basename` from `node:path`). Update the three existing tests that call `mapRow`/`ingestCsv` to pass/expect `source_file` (e.g. `expect(row.source_file).toBe("...")`).

- [ ] **Step 3: Re-run affected tests**

Run: `npm run test --workspace apps/api -- rowMapper ingestService`
Expected: PASS after updating expectations to include `source_file`.

- [ ] **Step 4: Typecheck & commit**

Run: `npm run build --workspace apps/api`
Expected: clean compile.

```
git add apps/api/src
git commit -m "feat(api): requests repository + source_file tracking`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.2: Server factory + health route

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\src\routes\health.ts`
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\src\server.ts`
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\src\index.ts`
- Test: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\tests\health.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server.js";

describe("GET /api/health", () => {
  it("returns ok with clickhouse status", async () => {
    const app = buildServer({
      cfg: {
        CLICKHOUSE_URL: "http://localhost:8123",
        CLICKHOUSE_USER: "x",
        CLICKHOUSE_PASSWORD: "",
        CLICKHOUSE_DB: "monitor",
        API_PORT: 8091,
        CARGAS_DIR: "/cargas",
        INGEST_BATCH_SIZE: 100,
        LOG_LEVEL: "silent",
      },
      pingClickHouse: async () => true,
    });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", clickhouse: true });
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/api -- health`
Expected: FAIL — module not found.

- [ ] **Step 3: Write src/routes/health.ts**

```ts
import type { FastifyInstance } from "fastify";

export function registerHealth(
  app: FastifyInstance,
  pingClickHouse: () => Promise<boolean>,
): void {
  app.get("/api/health", async () => {
    let ch = false;
    try {
      ch = await pingClickHouse();
    } catch {
      ch = false;
    }
    return { status: "ok", clickhouse: ch };
  });
}
```

- [ ] **Step 4: Write src/server.ts**

```ts
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import type { AppConfig } from "./config.js";
import { registerHealth } from "./routes/health.js";

export interface ServerDeps {
  cfg: AppConfig;
  pingClickHouse: () => Promise<boolean>;
  registerExtra?: (app: FastifyInstance) => void;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({
    logger:
      deps.cfg.LOG_LEVEL === "silent"
        ? false
        : { level: deps.cfg.LOG_LEVEL },
  });
  app.register(cors, { origin: true });
  app.register(sensible);
  registerHealth(app, deps.pingClickHouse);
  deps.registerExtra?.(app);
  return app;
}
```

- [ ] **Step 5: Write src/index.ts**

```ts
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { makeClickHouse, initSchema } from "./clickhouse.js";
import { JobStore } from "./ingest/jobStore.js";
import { RequestsRepo } from "./repo/requestsRepo.js";
import { registerFiles } from "./routes/files.js";
import { registerImport } from "./routes/import.js";
import { registerRequests } from "./routes/requests.js";
import { registerTransactions } from "./routes/transactions.js";

const cfg = loadConfig();
const ch = makeClickHouse(cfg);
const repo = new RequestsRepo(ch, cfg.CLICKHOUSE_DB);
const jobs = new JobStore();

const app = buildServer({
  cfg,
  pingClickHouse: async () => {
    const r = await ch.query({ query: "SELECT 1 AS ok", format: "JSON" });
    return ((await r.json()).data as { ok: number }[])[0]?.ok === 1;
  },
  registerExtra: (a) => {
    registerFiles(a, cfg);
    registerImport(a, { cfg, repo, jobs });
    registerRequests(a, repo);
    registerTransactions(a, repo);
  },
});

async function main() {
  await initSchema(ch, cfg.CLICKHOUSE_DB);
  await app.listen({ port: cfg.API_PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
```

> The `register*` route modules referenced here are created in Tasks 5.3–5.5. If implementing strictly in order, temporarily comment the four `register*` imports/calls until those tasks land, then uncomment. Note this in the commit.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test --workspace apps/api -- health`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```
git add apps/api/src/server.ts apps/api/src/index.ts apps/api/src/routes/health.ts apps/api/tests/health.test.ts
git commit -m "feat(api): server factory + health route`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.3: Files route (list CSVs in CARGAS_DIR)

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\src\routes\files.ts`
- Test: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\tests\files.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerFiles } from "../src/routes/files.js";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cargas-"));
  writeFileSync(join(dir, "a.csv"), "x");
  writeFileSync(join(dir, "note.txt"), "y");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("GET /api/files", () => {
  it("lists only .csv files with size", async () => {
    const app = Fastify();
    registerFiles(app, { CARGAS_DIR: dir } as never);
    const res = await app.inject({ method: "GET", url: "/api/files" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { name: string; size: number }[];
    expect(body.map((f) => f.name)).toEqual(["a.csv"]);
    expect(body[0].size).toBeGreaterThan(0);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/api -- files`
Expected: FAIL — module not found.

- [ ] **Step 3: Write src/routes/files.ts**

```ts
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";

export function registerFiles(
  app: FastifyInstance,
  cfg: Pick<AppConfig, "CARGAS_DIR">,
): void {
  app.get("/api/files", async () => {
    const entries = await readdir(cfg.CARGAS_DIR);
    const csvs = entries.filter((e) => e.toLowerCase().endsWith(".csv"));
    const out = [];
    for (const name of csvs) {
      const s = await stat(join(cfg.CARGAS_DIR, name));
      out.push({ name, size: s.size, modified: s.mtime.toISOString() });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace apps/api -- files`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```
git add apps/api/src/routes/files.ts apps/api/tests/files.test.ts
git commit -m "feat(api): list CSV files route`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.4: Import route (trigger + progress, file-replace)

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\src\routes\import.ts`
- Test: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\tests\import.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import { registerImport } from "../src/routes/import.js";
import { JobStore } from "../src/ingest/jobStore.js";

const here = dirname(fileURLToPath(import.meta.url));

function fakeRepo() {
  const inserted: unknown[] = [];
  return {
    inserted,
    deleteByFileName: async () => {},
    insertRows: async (rows: unknown[]) => {
      inserted.push(...rows);
    },
  };
}

describe("import route", () => {
  it("starts a job and reports progress until done", async () => {
    const app = Fastify();
    const jobs = new JobStore();
    const repo = fakeRepo();
    registerImport(app, {
      cfg: { CARGAS_DIR: join(here, "fixtures"), INGEST_BATCH_SIZE: 2 } as never,
      repo: repo as never,
      jobs,
    });

    const start = await app.inject({
      method: "POST",
      url: "/api/import",
      payload: { file: "sample.csv" },
    });
    expect(start.statusCode).toBe(202);
    const { jobId } = start.json() as { jobId: string };
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);

    // poll until finished
    let job: { status: string; rowsInserted: number } | undefined;
    for (let i = 0; i < 50; i++) {
      const r = await app.inject({ method: "GET", url: `/api/import/${jobId}` });
      job = r.json() as never;
      if (job!.status !== "running") break;
      await new Promise((res) => setTimeout(res, 20));
    }
    expect(job!.status).toBe("done");
    expect(job!.rowsInserted).toBe(3);
    expect(repo.inserted.length).toBe(3);
    await app.close();
  });

  it("rejects unknown or non-csv files with 400", async () => {
    const app = Fastify();
    registerImport(app, {
      cfg: { CARGAS_DIR: join(here, "fixtures"), INGEST_BATCH_SIZE: 2 } as never,
      repo: fakeRepo() as never,
      jobs: new JobStore(),
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/import",
      payload: { file: "../secrets.txt" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/api -- import`
Expected: FAIL — module not found.

- [ ] **Step 3: Write src/routes/import.ts**

```ts
import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { JobStore } from "../ingest/jobStore.js";
import { ingestCsv } from "../ingest/ingestService.js";

interface RepoLike {
  deleteByFileName: (file: string) => Promise<void>;
  insertRows: (rows: unknown[]) => Promise<void>;
}

interface Deps {
  cfg: Pick<AppConfig, "CARGAS_DIR" | "INGEST_BATCH_SIZE">;
  repo: RepoLike;
  jobs: JobStore;
}

export function registerImport(app: FastifyInstance, deps: Deps): void {
  app.post<{ Body: { file?: string } }>("/api/import", async (req, reply) => {
    const requested = req.body?.file ?? "";
    const safe = basename(requested);
    if (
      !safe ||
      safe !== requested ||
      !safe.toLowerCase().endsWith(".csv")
    ) {
      return reply.code(400).send({ error: "bad_request", message: "invalid file name" });
    }
    const full = join(deps.cfg.CARGAS_DIR, safe);
    if (!existsSync(full)) {
      return reply.code(400).send({ error: "not_found", message: "file not found in cargas" });
    }

    const job = deps.jobs.create(safe);
    reply.code(202).send({ jobId: job.id });

    // run asynchronously after responding
    void (async () => {
      try {
        await deps.repo.deleteByFileName(safe);
        const result = await ingestCsv({
          filePath: full,
          ingestBatch: randomUUID(),
          batchSize: deps.cfg.INGEST_BATCH_SIZE,
          insert: async (rows) => {
            await deps.repo.insertRows(rows);
          },
          onProgress: (p) => deps.jobs.update(job.id, p),
        });
        deps.jobs.update(job.id, result);
        deps.jobs.finish(job.id, "done");
      } catch (err) {
        deps.jobs.finish(
          job.id,
          "failed",
          err instanceof Error ? err.message : String(err),
        );
      }
    })();
  });

  app.get<{ Params: { id: string } }>("/api/import/:id", async (req, reply) => {
    const job = deps.jobs.get(req.params.id);
    if (!job) return reply.code(404).send({ error: "not_found", message: "job not found" });
    return job;
  });
}
```

> Note: `insert` failures inside `ingestCsv` are counted as `parseErrors` (per Task 4.2) so the job still completes `done` with a non-zero error count rather than throwing. A hard failure (e.g. `deleteByFileName` rejects) marks the job `failed`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace apps/api -- import`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```
git add apps/api/src/routes/import.ts apps/api/tests/import.test.ts
git commit -m "feat(api): import trigger + progress route`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.5: Requests & transactions routes

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\src\routes\requests.ts`
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\src\routes\transactions.ts`
- Test: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\tests\requests.test.ts`

These delegate to `RequestsRepo`. The test injects a fake repo to verify query-param parsing and wiring (no live ClickHouse).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerRequests } from "../src/routes/requests.js";
import { registerTransactions } from "../src/routes/transactions.js";

function repo() {
  return {
    calls: [] as unknown[],
    async list(f: unknown) { this.calls.push(["list", f]); return { data: [], total: 0, page: 1, pageSize: 25 }; },
    async stats(f: unknown) { this.calls.push(["stats", f]); return { byDay: [], byScript: [], byTitulo: [], total: 0 }; },
    async byId(id: number) { this.calls.push(["byId", id]); return id === 1 ? { id_interno: 1 } : null; },
    async byTxn(t: string) { this.calls.push(["byTxn", t]); return [{ txn_id: t }]; },
  };
}

describe("requests/transactions routes", () => {
  it("GET /api/requests parses filters and paging", async () => {
    const app = Fastify(); const r = repo();
    registerRequests(app, r as never);
    const res = await app.inject({ method: "GET", url: "/api/requests?tipo=Depurar&page=2&pageSize=10" });
    expect(res.statusCode).toBe(200);
    expect(r.calls[0]).toEqual(["list", expect.objectContaining({ tipo: "Depurar", page: 2, pageSize: 10 })]);
    await app.close();
  });

  it("GET /api/stats works", async () => {
    const app = Fastify(); const r = repo();
    registerRequests(app, r as never);
    const res = await app.inject({ method: "GET", url: "/api/stats?from=2026-05-01&to=2026-05-31" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 0 });
    await app.close();
  });

  it("GET /api/requests/:id returns 404 when missing", async () => {
    const app = Fastify(); const r = repo();
    registerRequests(app, r as never);
    expect((await app.inject({ method: "GET", url: "/api/requests/1" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/requests/999" })).statusCode).toBe(404);
    await app.close();
  });

  it("GET /api/transactions/:txn returns events", async () => {
    const app = Fastify(); const r = repo();
    registerTransactions(app, r as never);
    const res = await app.inject({ method: "GET", url: "/api/transactions/360738" });
    expect(res.json()).toEqual([{ txn_id: "360738" }]);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/api -- requests`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write src/routes/requests.ts**

```ts
import type { FastifyInstance } from "fastify";
import type { RequestsRepo } from "../repo/requestsRepo.js";

export function registerRequests(app: FastifyInstance, repo: RequestsRepo): void {
  app.get<{ Querystring: Record<string, string> }>("/api/requests", async (req) => {
    const q = req.query;
    return repo.list({
      from: q.from || undefined,
      to: q.to || undefined,
      tipo: q.tipo || undefined,
      titulo: q.titulo || undefined,
      status: q.status || undefined,
      q: q.q || undefined,
      page: Math.max(1, Number(q.page) || 1),
      pageSize: Math.min(200, Math.max(1, Number(q.pageSize) || 25)),
    });
  });

  app.get<{ Querystring: Record<string, string> }>("/api/stats", async (req) => {
    return repo.stats({ from: req.query.from || undefined, to: req.query.to || undefined });
  });

  app.get<{ Params: { id: string } }>("/api/requests/:id", async (req, reply) => {
    const row = await repo.byId(Number(req.params.id));
    if (!row) return reply.code(404).send({ error: "not_found", message: "request not found" });
    return row;
  });
}
```

- [ ] **Step 4: Write src/routes/transactions.ts**

```ts
import type { FastifyInstance } from "fastify";
import type { RequestsRepo } from "../repo/requestsRepo.js";

export function registerTransactions(app: FastifyInstance, repo: RequestsRepo): void {
  app.get<{ Params: { txn: string } }>("/api/transactions/:txn", async (req) => {
    return repo.byTxn(req.params.txn);
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace apps/api -- requests`
Expected: PASS (4 tests).

- [ ] **Step 6: Full API test run + commit**

Run: `npm run test --workspace apps/api`
Expected: ALL suites PASS.

```
git add apps/api/src/routes/requests.ts apps/api/src/routes/transactions.ts apps/api/tests/requests.test.ts
git commit -m "feat(api): requests + transactions query routes`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.6: API Dockerfile

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\Dockerfile`
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\api\.dockerignore`

- [ ] **Step 1: Write apps/api/.dockerignore**

```
node_modules
dist
tests
```

- [ ] **Step 2: Write apps/api/Dockerfile**

```dockerfile
# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace apps/api --include-workspace-root
COPY apps/api ./apps/api
RUN npm run build --workspace apps/api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace apps/api --omit=dev --include-workspace-root
COPY --from=build /app/apps/api/dist ./apps/api/dist
WORKDIR /app/apps/api
EXPOSE 8091
CMD ["node", "dist/index.js"]
```

- [ ] **Step 3: Build the image**

Run (from repo root): `docker build -f apps/api/Dockerfile -t monitor-api:dev .`
Expected: image builds successfully.

- [ ] **Step 4: Commit**

```
git add apps/api/Dockerfile apps/api/.dockerignore
git commit -m "chore(api): Dockerfile`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — Web: project setup

### Task 6.1: Web scaffold (Vite + React 19 + Tailwind 4 + Vitest)

**Files:**
- Create `apps/web/package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `vitest.setup.ts`, `index.html`, `src/main.tsx`, `src/index.css`
  (all under `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\web\`)

- [ ] **Step 1: Write apps/web/package.json**

```json
{
  "name": "@monitor/web",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "19.2.6",
    "react-dom": "19.2.6",
    "react-router-dom": "7.15.1",
    "recharts": "3.8.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "4.3.0",
    "@testing-library/jest-dom": "6.9.1",
    "@testing-library/react": "16.3.2",
    "@testing-library/user-event": "14.6.1",
    "@types/react": "19.2.14",
    "@types/react-dom": "19.2.3",
    "@vitejs/plugin-react": "6.0.2",
    "jsdom": "29.1.1",
    "tailwindcss": "4.3.0",
    "typescript": "6.0.3",
    "vite": "8.0.13",
    "vitest": "4.1.6"
  }
}
```

- [ ] **Step 2: Write apps/web/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vitest.setup.ts"]
}
```

- [ ] **Step 3: Write apps/web/tsconfig.node.json**

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 4: Write apps/web/vite.config.ts**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwind()],
  server: { port: 5173 },
});
```

- [ ] **Step 5: Write apps/web/vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.tsx"],
  },
});
```

- [ ] **Step 6: Write apps/web/vitest.setup.ts**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 7: Write apps/web/index.html**

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Monitor de Integração</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: Write apps/web/src/index.css**

```css
@import "tailwindcss";
```

- [ ] **Step 9: Write apps/web/src/main.tsx**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.js";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

> `App.tsx` is created in Task 6.3. To keep the tree compiling between tasks, create a one-line placeholder `apps/web/src/App.tsx` now: `export default function App(){return null;}` — it is fully replaced in Task 6.3.

- [ ] **Step 10: Install & build sanity**

Run (repo root): `npm install`
Then: `npm run build --workspace apps/web`
Expected: type-checks and builds (placeholder App), produces `apps/web/dist`.

- [ ] **Step 11: Commit**

```
git add apps/web package-lock.json
git commit -m "chore(web): scaffold Vite/React19/Tailwind4`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6.2: Typed API client

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\web\src\api\client.ts`
- Test: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\web\src\api\client.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "./client.js";

afterEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("GETs JSON from the configured base url", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ name: "a.csv" }]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const files = await api.files();
    expect(files).toEqual([{ name: "a.csv" }]);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/files");
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );
    await expect(api.files()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/web -- client`
Expected: FAIL — module not found.

- [ ] **Step 3: Write src/api/client.ts**

```ts
const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export interface FileInfo { name: string; size: number; modified: string; }
export interface ImportJob {
  id: string; file: string;
  status: "running" | "done" | "failed";
  rowsProcessed: number; rowsInserted: number; parseErrors: number;
  error: string | null; startedAt: string; finishedAt: string | null;
}
export interface RequestSummary {
  id_interno: number; event_ts: string; nome: string; titulo: string;
  tipo: string; tipo_script: string; txn_id: string; txn_type: string;
  integra_id: string; status: string;
}
export interface ListResult {
  data: RequestSummary[]; total: number; page: number; pageSize: number;
}
export interface Stats {
  byDay: { day: string; total: string }[];
  byScript: { tipo_script: string; total: string }[];
  byTitulo: { titulo: string; total: string }[];
  total: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return (await res.json()) as T;
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return (await res.json()) as T;
}

export const api = {
  health: () => get<{ status: string; clickhouse: boolean }>("/api/health"),
  files: () => get<FileInfo[]>("/api/files"),
  startImport: (file: string) => post<{ jobId: string }>("/api/import", { file }),
  importStatus: (id: string) => get<ImportJob>(`/api/import/${id}`),
  stats: (qs = "") => get<Stats>(`/api/stats${qs}`),
  requests: (qs = "") => get<ListResult>(`/api/requests${qs}`),
  request: (id: number) => get<Record<string, unknown>>(`/api/requests/${id}`),
  transaction: (txn: string) => get<RequestSummary[]>(`/api/transactions/${encodeURIComponent(txn)}`),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace apps/web -- client`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```
git add apps/web/src/api/client.ts apps/web/src/api/client.test.tsx
git commit -m "feat(web): typed API client`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6.3: Layout, AsyncState, router shell

**Files:**
- Create: `apps/web/src/components/AsyncState.tsx`
- Create: `apps/web/src/components/Layout.tsx`
- Create: `apps/web/src/App.tsx` (replaces placeholder)
- Test: `apps/web/src/components/AsyncState.test.tsx`
  (under `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\apps\web\`)

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AsyncState } from "./AsyncState.js";

describe("AsyncState", () => {
  it("shows loading", () => {
    render(<AsyncState loading error={null} empty={false}>x</AsyncState>);
    expect(screen.getByText(/carregando/i)).toBeInTheDocument();
  });
  it("shows error", () => {
    render(<AsyncState loading={false} error="boom" empty={false}>x</AsyncState>);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
  it("shows empty", () => {
    render(<AsyncState loading={false} error={null} empty>x</AsyncState>);
    expect(screen.getByText(/nenhum dado/i)).toBeInTheDocument();
  });
  it("renders children when ready", () => {
    render(<AsyncState loading={false} error={null} empty={false}><span>ready</span></AsyncState>);
    expect(screen.getByText("ready")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/web -- AsyncState`
Expected: FAIL — module not found.

- [ ] **Step 3: Write src/components/AsyncState.tsx**

```tsx
import type { ReactNode } from "react";

export function AsyncState(props: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  children: ReactNode;
}) {
  if (props.loading)
    return <div className="p-6 text-slate-500">Carregando…</div>;
  if (props.error)
    return <div className="p-6 text-red-600">Erro: {props.error}</div>;
  if (props.empty)
    return <div className="p-6 text-slate-500">Nenhum dado encontrado.</div>;
  return <>{props.children}</>;
}
```

- [ ] **Step 4: Write src/components/Layout.tsx**

```tsx
import { NavLink, Outlet } from "react-router-dom";

const tabs = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/requests", label: "Requests" },
  { to: "/import", label: "Importação" },
];

export function Layout() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center gap-6">
        <h1 className="font-semibold">Monitor de Integração</h1>
        <nav className="flex gap-4 text-sm">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                isActive ? "text-white" : "text-slate-400 hover:text-white"
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Write src/App.tsx**

```tsx
import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Requests } from "./pages/Requests.js";
import { Transaction } from "./pages/Transaction.js";
import { Import } from "./pages/Import.js";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="requests" element={<Requests />} />
        <Route path="transactions/:txn" element={<Transaction />} />
        <Route path="import" element={<Import />} />
      </Route>
    </Routes>
  );
}
```

> Pages are created in Tasks 6.4–6.6. Until then the app won't typecheck. Implement Tasks 6.4–6.6 before running the web build; the per-task tests below don't require the full router.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test --workspace apps/web -- AsyncState`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```
git add apps/web/src/components apps/web/src/App.tsx
git commit -m "feat(web): layout, router shell, async-state`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6.4: Dashboard page (volume/timeline)

**Files:**
- Create: `apps/web/src/pages/Dashboard.tsx`
- Test: `apps/web/src/pages/Dashboard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Dashboard } from "./Dashboard.js";

afterEach(() => vi.restoreAllMocks());

describe("Dashboard", () => {
  it("renders total and charts after loading stats", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            byDay: [{ day: "2026-05-15", total: "2" }],
            byScript: [{ tipo_script: "Evento de usuário", total: "2" }],
            byTitulo: [{ titulo: "nr", total: "2" }],
            total: 2,
          }),
          { status: 200 },
        ),
      ),
    );
    render(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText(/total de requests/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/web -- Dashboard`
Expected: FAIL — module not found.

- [ ] **Step 3: Write src/pages/Dashboard.tsx**

```tsx
import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { api, type Stats } from "../api/client.js";
import { AsyncState } from "../components/AsyncState.js";

export function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <AsyncState
      loading={!stats && !error}
      error={error}
      empty={!!stats && stats.total === 0}
    >
      {stats && (
        <div className="space-y-6">
          <div className="rounded bg-white p-4 shadow">
            <p className="text-sm text-slate-500">Total de requests</p>
            <p className="text-3xl font-bold">{stats.total}</p>
          </div>
          <div className="rounded bg-white p-4 shadow">
            <h2 className="mb-2 font-semibold">Volume por dia</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats.byDay.map((d) => ({ day: d.day, total: Number(d.total) }))}>
                <XAxis dataKey="day" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="total" fill="#0f172a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded bg-white p-4 shadow">
              <h2 className="mb-2 font-semibold">Por tipo de script</h2>
              <ul className="text-sm">
                {stats.byScript.map((s) => (
                  <li key={s.tipo_script} className="flex justify-between border-b py-1">
                    <span>{s.tipo_script || "(vazio)"}</span><span>{s.total}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded bg-white p-4 shadow">
              <h2 className="mb-2 font-semibold">Por título</h2>
              <ul className="text-sm">
                {stats.byTitulo.map((s) => (
                  <li key={s.titulo} className="flex justify-between border-b py-1">
                    <span>{s.titulo || "(vazio)"}</span><span>{s.total}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </AsyncState>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace apps/web -- Dashboard`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```
git add apps/web/src/pages/Dashboard.tsx apps/web/src/pages/Dashboard.test.tsx
git commit -m "feat(web): dashboard page`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6.5: Requests page (filters, table, drill-down) + JsonViewer

**Files:**
- Create: `apps/web/src/components/JsonViewer.tsx`
- Create: `apps/web/src/pages/Requests.tsx`
- Test: `apps/web/src/pages/Requests.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Requests } from "./Requests.js";

afterEach(() => vi.restoreAllMocks());

const listResponse = {
  data: [{
    id_interno: 3262308, event_ts: "2026-05-15 01:06:00",
    nome: "[CCC] MSG", titulo: "nr", tipo: "Depurar",
    tipo_script: "Evento de usuário", txn_id: "360738",
    txn_type: "invoice", integra_id: "38967664", status: "unknown",
  }],
  total: 1, page: 1, pageSize: 25,
};

describe("Requests", () => {
  it("loads and displays rows; opens drill-down", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(listResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id_interno: 3262308, detalhes: "{\"id\":\"360738\"}" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<MemoryRouter><Requests /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("360738")).toBeInTheDocument());

    await userEvent.click(screen.getByText("360738"));
    await waitFor(() =>
      expect(screen.getByText(/"id": "360738"/)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/web -- Requests`
Expected: FAIL — module not found.

- [ ] **Step 3: Write src/components/JsonViewer.tsx**

```tsx
export function JsonViewer({ value }: { value: unknown }) {
  let text: string;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    text = JSON.stringify(parsed, null, 2);
  } catch {
    text = typeof value === "string" ? value : JSON.stringify(value);
  }
  return (
    <pre className="max-h-[60vh] overflow-auto rounded bg-slate-900 p-4 text-xs text-green-200">
      {text}
    </pre>
  );
}
```

- [ ] **Step 4: Write src/pages/Requests.tsx**

```tsx
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api, type ListResult } from "../api/client.js";
import { AsyncState } from "../components/AsyncState.js";
import { JsonViewer } from "../components/JsonViewer.js";

export function Requests() {
  const [result, setResult] = useState<ListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ tipo: "", titulo: "", status: "", q: "" });
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(() => {
    setResult(null);
    setError(null);
    const qs = new URLSearchParams(
      Object.entries({ ...filters, page: String(page), pageSize: "25" })
        .filter(([, v]) => v !== ""),
    ).toString();
    api.requests(`?${qs}`).then(setResult).catch((e: Error) => setError(e.message));
  }, [filters, page]);

  useEffect(load, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["tipo", "titulo", "status", "q"] as const).map((k) => (
          <input
            key={k}
            placeholder={k === "q" ? "busca (id/integra_id/texto)" : k}
            className="rounded border px-2 py-1 text-sm"
            value={filters[k]}
            onChange={(e) => setFilters((f) => ({ ...f, [k]: e.target.value }))}
          />
        ))}
        <button
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white"
          onClick={() => { setPage(1); load(); }}
        >
          Filtrar
        </button>
      </div>

      <AsyncState
        loading={!result && !error}
        error={error}
        empty={!!result && result.data.length === 0}
      >
        {result && (
          <>
            <table className="w-full border-collapse bg-white text-sm shadow">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="p-2">ID interno</th><th className="p-2">Data/Hora</th>
                  <th className="p-2">Título</th><th className="p-2">Tipo</th>
                  <th className="p-2">txn_id</th><th className="p-2">integra_id</th>
                  <th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((r) => (
                  <tr key={r.id_interno} className="border-b hover:bg-slate-50">
                    <td className="p-2">
                      <button
                        className="text-blue-700 underline"
                        onClick={() =>
                          api.request(r.id_interno).then(setDetail).catch(() => {})
                        }
                      >
                        {r.id_interno}
                      </button>
                    </td>
                    <td className="p-2">{r.event_ts}</td>
                    <td className="p-2">{r.titulo}</td>
                    <td className="p-2">{r.tipo}</td>
                    <td className="p-2">
                      {r.txn_id ? (
                        <Link className="text-blue-700 underline" to={`/transactions/${r.txn_id}`}>
                          {r.txn_id}
                        </Link>
                      ) : "—"}
                    </td>
                    <td className="p-2">{r.integra_id || "—"}</td>
                    <td className="p-2">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex items-center gap-3 text-sm">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                className="rounded border px-2 py-1 disabled:opacity-40">Anterior</button>
              <span>Página {result.page} — {result.total} registros</span>
              <button disabled={page * result.pageSize >= result.total}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border px-2 py-1 disabled:opacity-40">Próxima</button>
            </div>
          </>
        )}
      </AsyncState>

      {detail && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 p-6"
          onClick={() => setDetail(null)}>
          <div className="w-full max-w-3xl rounded bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-between">
              <h3 className="font-semibold">Payload do request</h3>
              <button onClick={() => setDetail(null)}>✕</button>
            </div>
            <JsonViewer value={detail.detalhes ?? detail} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace apps/web -- Requests`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```
git add apps/web/src/components/JsonViewer.tsx apps/web/src/pages/Requests.tsx apps/web/src/pages/Requests.test.tsx
git commit -m "feat(web): requests table + drill-down`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6.6: Transaction page + Import page

**Files:**
- Create: `apps/web/src/pages/Transaction.tsx`
- Create: `apps/web/src/pages/Import.tsx`
- Test: `apps/web/src/pages/Import.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Import } from "./Import.js";

afterEach(() => vi.restoreAllMocks());

describe("Import", () => {
  it("lists files, starts import, polls until done", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ name: "sample.csv", size: 10, modified: "2026-05-16T00:00:00Z" }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "job-1" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", file: "sample.csv", status: "done", rowsProcessed: 3, rowsInserted: 3, parseErrors: 0, error: null, startedAt: "", finishedAt: "" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Import />);
    await waitFor(() => expect(screen.getByText("sample.csv")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /importar/i }));
    await waitFor(() => expect(screen.getByText(/done/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace apps/web -- Import`
Expected: FAIL — module not found.

- [ ] **Step 3: Write src/pages/Transaction.tsx**

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type RequestSummary } from "../api/client.js";
import { AsyncState } from "../components/AsyncState.js";

export function Transaction() {
  const { txn } = useParams();
  const [events, setEvents] = useState<RequestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!txn) return;
    api.transaction(txn).then(setEvents).catch((e: Error) => setError(e.message));
  }, [txn]);

  return (
    <AsyncState
      loading={!events && !error}
      error={error}
      empty={!!events && events.length === 0}
    >
      {events && (
        <div className="space-y-2">
          <h2 className="font-semibold">Transação {txn}</h2>
          <ol className="border-l-2 border-slate-300 pl-4">
            {events.map((e) => (
              <li key={e.id_interno} className="mb-3">
                <p className="text-sm text-slate-500">{e.event_ts}</p>
                <p className="font-medium">{e.titulo} — {e.nome}</p>
                <p className="text-xs text-slate-600">
                  id_interno {e.id_interno} · {e.tipo_script} · status {e.status}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </AsyncState>
  );
}
```

- [ ] **Step 4: Write src/pages/Import.tsx**

```tsx
import { useEffect, useRef, useState } from "react";
import { api, type FileInfo, type ImportJob } from "../api/client.js";
import { AsyncState } from "../components/AsyncState.js";

export function Import() {
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.files().then(setFiles).catch((e: Error) => setError(e.message));
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const start = async (file: string) => {
    setJob(null);
    const { jobId } = await api.startImport(file);
    timer.current = setInterval(async () => {
      const j = await api.importStatus(jobId);
      setJob(j);
      if (j.status !== "running" && timer.current) clearInterval(timer.current);
    }, 1000);
  };

  return (
    <div className="space-y-4">
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
                      onClick={() => start(f.name)}
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

      {job && (
        <div className="rounded bg-white p-4 shadow text-sm">
          <p>Arquivo: <b>{job.file}</b></p>
          <p>Status: <b>{job.status}</b></p>
          <p>Linhas processadas: {job.rowsProcessed}</p>
          <p>Linhas inseridas: {job.rowsInserted}</p>
          <p>Erros: {job.parseErrors}</p>
          {job.error && <p className="text-red-600">Erro: {job.error}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace apps/web -- Import`
Expected: PASS (1 test).

- [ ] **Step 6: Full web suite + build**

Run: `npm run test --workspace apps/web`
Expected: ALL web tests PASS.
Run: `npm run build --workspace apps/web`
Expected: type-checks and builds successfully (full router now resolves).

- [ ] **Step 7: Commit**

```
git add apps/web/src/pages/Transaction.tsx apps/web/src/pages/Import.tsx apps/web/src/pages/Import.test.tsx
git commit -m "feat(web): transaction timeline + import page`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6.7: Web Dockerfile + Nginx

**Files:**
- Create: `apps/web/nginx.conf`
- Create: `apps/web/Dockerfile`
- Create: `apps/web/.dockerignore`

- [ ] **Step 1: Write apps/web/.dockerignore**

```
node_modules
dist
```

- [ ] **Step 2: Write apps/web/nginx.conf**

```
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;
  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

- [ ] **Step 3: Write apps/web/Dockerfile**

```dockerfile
# Build from repo root: docker build -f apps/web/Dockerfile --build-arg VITE_API_BASE_URL=http://192.168.56.113:8091 .
FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace apps/web --include-workspace-root
COPY apps/web ./apps/web
RUN npm run build --workspace apps/web

FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
```

- [ ] **Step 4: Build the image**

Run (repo root): `docker build -f apps/web/Dockerfile --build-arg VITE_API_BASE_URL=http://192.168.56.113:8091 -t monitor-web:dev .`
Expected: image builds successfully.

- [ ] **Step 5: Commit**

```
git add apps/web/Dockerfile apps/web/.dockerignore apps/web/nginx.conf
git commit -m "chore(web): Dockerfile + nginx`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7 — Orchestration & verification

### Task 7.1: docker-compose

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\docker-compose.yml`

- [ ] **Step 1: Write docker-compose.yml**

```yaml
# Standalone monitor stack — separate from R2P. Dedicated high ports.
services:
  monitor-api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    container_name: monitor-api
    restart: unless-stopped
    environment:
      CLICKHOUSE_URL: ${CLICKHOUSE_URL}
      CLICKHOUSE_USER: ${CLICKHOUSE_USER}
      CLICKHOUSE_PASSWORD: ${CLICKHOUSE_PASSWORD}
      CLICKHOUSE_DB: ${CLICKHOUSE_DB}
      API_PORT: 8091
      CARGAS_DIR: /cargas
      INGEST_BATCH_SIZE: ${INGEST_BATCH_SIZE}
      LOG_LEVEL: ${LOG_LEVEL}
    ports:
      - "8091:8091"
    volumes:
      - ./cargas:/cargas:ro

  monitor-web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      args:
        VITE_API_BASE_URL: ${VITE_API_BASE_URL}
    container_name: monitor-web
    restart: unless-stopped
    depends_on:
      - monitor-api
    ports:
      - "8090:80"
```

- [ ] **Step 2: Validate compose config**

Run (repo root, with a populated `.env` copied from `.env.example`):
```
copy .env.example .env
docker compose config
```
Expected: prints the resolved config with no errors; `8090`/`8091` ports and `./cargas:/cargas:ro` mount present.

- [ ] **Step 3: Commit**

```
git add docker-compose.yml
git commit -m "chore: docker-compose for standalone monitor stack`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 7.2: README + end-to-end smoke

**Files:**
- Create: `C:\Users\Wagner\OneDrive\Pessoal\Documentos\Netsuite\WebhoohMonitor\README.md`

- [ ] **Step 1: Write README.md**

```markdown
# Monitor de Integração NetSuite

Stack standalone (separada do R2P) para monitorar requests de integração do
NetSuite a partir de CSVs em `./cargas`.

## Componentes
- `apps/api` — Fastify + ingestão streaming + ClickHouse client (porta 8091)
- `apps/web` — React 19 + Vite + Tailwind 4 (porta 8090, Nginx)
- ClickHouse: **externo, já existente** em 192.168.56.127 (não provisionado aqui)

## Rodar
1. `copy .env.example .env` e ajuste valores.
2. Coloque o CSV em `./cargas/`.
3. `docker compose up -d --build`
4. Acesse `http://192.168.56.113:8090` (ou `http://localhost:8090` localmente).
5. Aba **Importação** → escolher arquivo → **Importar** → acompanhar progresso.

## Desenvolvimento
- `npm install`
- `npm test` (api + web)
- `npm run dev:api` / `npm run dev:web`

## Notas
- A regra de classificação de status (sucesso/erro) ainda não está definida;
  `status` é gravado como `unknown`.
- Reimportar o mesmo arquivo substitui os dados daquele arquivo (`source_file`).
```

- [ ] **Step 2: Full test suite**

Run (repo root): `npm test`
Expected: ALL api and web suites PASS.

- [ ] **Step 3: End-to-end smoke (requires reachable ClickHouse at 192.168.56.127)**

Run (repo root):
```
docker compose up -d --build
curl http://localhost:8091/api/health
```
Expected: `{"status":"ok","clickhouse":true}`. Then in the browser open `http://localhost:8090`, go to **Importação**, import `sample.csv` (copy `apps/api/tests/fixtures/sample.csv` into `./cargas/` for the smoke), confirm job reaches `done` with 3 rows, then check Dashboard shows total 3 and Requests lists the rows.

If ClickHouse is unreachable from the build/dev machine: document it, mark `clickhouse:false` expected, and defer the live smoke to deployment on 192.168.56.113. All unit/integration suites must still pass.

- [ ] **Step 4: Commit**

```
git add README.md
git commit -m "docs: README + run instructions`n`nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes (resolved)

- **Spec coverage:** manual import via UI (Task 5.4, 6.6); volume/timeline (5.1 `stats`, 6.4); search/drill-down (5.1 `list`/`byId`, 6.5); transaction trace (5.1 `byTxn`, 6.6 Transaction); status `unknown` (types 1.2, rowMapper 2.3); streaming ingest of 1.2 GB without loading to memory (4.2); existing ClickHouse, only DB/tables created (3.1); separate containers + dedicated ports 8090/8091, isolated from R2P (7.1); CSV gitignored (0.1); `.env`/`.env.example` (0.3); latest pinned versions (header + 1.1/6.1); TDD with frequent commits (every task).
- **Placeholder scan:** the only intentional inert stub (`deleteByFile` in 5.1) is explicitly removed/replaced in Task 5.1 Step 2 with `deleteByFileName` + `source_file` column; flagged inline.
- **Type consistency:** `RequestRow` gains `source_file` (5.1 Step 2) consistently across `types.ts`, `rowMapper.ts`, `ingestService.ts`, `clickhouse.ts` DDL, and `requestsRepo.deleteByFileName`. API client DTOs (`FileInfo`, `ImportJob`, `RequestSummary`, `ListResult`, `Stats`) match API responses from routes in Phase 5. `api.*` method names used by pages (6.4–6.6) match `client.ts` (6.2).
- **Cross-task ordering caveats** are called out where a file references not-yet-created modules (`index.ts` in 5.2, `App.tsx`/`main.tsx` in 6.1/6.3): comment-then-uncomment or placeholder strategy documented in-task.
```
