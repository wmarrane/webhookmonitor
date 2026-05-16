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
