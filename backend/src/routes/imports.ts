import { basename } from "node:path";
import type { FastifyInstance } from "fastify";
import type { IngestJobRepo } from "../ingest/runJob.js";

interface Deps {
  repo: Pick<IngestJobRepo, "fileStats">;
}

export function registerImportsExists(app: FastifyInstance, deps: Deps): void {
  app.get<{ Querystring: { file?: string } }>(
    "/api/imports/exists",
    async (req, reply) => {
      const requested = req.query.file ?? "";
      const safe = basename(requested);
      if (!safe || safe !== requested) {
        return reply
          .code(400)
          .send({ error: "bad_request", message: "invalid file name" });
      }
      const { rows, lastIngestedAt } = await deps.repo.fileStats(safe);
      return { exists: rows > 0, rows, lastIngestedAt };
    },
  );
}
