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
