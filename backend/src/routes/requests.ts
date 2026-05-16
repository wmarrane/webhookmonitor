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
      page: Math.max(1, Math.trunc(Number(q.page)) || 1),
      pageSize: Math.min(200, Math.max(1, Math.trunc(Number(q.pageSize)) || 25)),
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
