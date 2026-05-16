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
