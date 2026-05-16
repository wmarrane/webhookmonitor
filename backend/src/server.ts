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
