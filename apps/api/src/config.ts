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
