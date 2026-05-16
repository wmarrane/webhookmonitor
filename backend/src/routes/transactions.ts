import type { FastifyInstance } from "fastify";
import type { RequestsRepo } from "../repo/requestsRepo.js";

export function registerTransactions(app: FastifyInstance, repo: RequestsRepo): void {
  app.get<{ Params: { txn: string } }>("/api/transactions/:txn", async (req) => {
    return repo.byTxn(req.params.txn);
  });
}
