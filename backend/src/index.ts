import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { makeClickHouse, initSchema } from "./clickhouse.js";
import { JobStore } from "./ingest/jobStore.js";
import { RequestsRepo } from "./repo/requestsRepo.js";
import { registerFiles } from "./routes/files.js";
import { registerImport } from "./routes/import.js";
import { registerRequests } from "./routes/requests.js";
import { registerTransactions } from "./routes/transactions.js";
import multipart from "@fastify/multipart";
import { registerUpload } from "./routes/upload.js";

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
    a.register(multipart);
    registerFiles(a, cfg);
    registerImport(a, { cfg, repo, jobs });
    registerRequests(a, repo);
    registerTransactions(a, repo);
    registerUpload(a, { cfg, repo, jobs }, { statusRoute: false });
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
