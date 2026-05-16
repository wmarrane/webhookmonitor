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
  await client.command({ query: `CREATE DATABASE IF NOT EXISTS \`${db}\`` });
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS \`${db}\`.requests (
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
