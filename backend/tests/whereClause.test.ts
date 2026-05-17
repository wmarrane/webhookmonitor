import { describe, it, expect } from "vitest";
import { buildWhereClause } from "../src/repo/requestsRepo.js";

describe("buildWhereClause", () => {
  it("returns empty sql/params when no filters", () => {
    const r = buildWhereClause({ page: 1, pageSize: 25 });
    expect(r.sql).toBe("");
    expect(r.params).toEqual({});
  });

  it("builds date/tipo/titulo/status clauses with params", () => {
    const r = buildWhereClause({
      from: "2026-05-01", to: "2026-05-31",
      tipo: "Depurar", titulo: "nr", status: "unknown",
      page: 2, pageSize: 10,
    });
    expect(r.sql).toContain("event_ts >= {from:DateTime}");
    expect(r.sql).toContain("event_ts <= {to:DateTime}");
    expect(r.sql).toContain("tipo = {tipo:String}");
    expect(r.sql).toContain("titulo = {titulo:String}");
    expect(r.sql).toContain("status = {status:String}");
    expect(r.params).toMatchObject({
      from: "2026-05-01 00:00:00", to: "2026-05-31 23:59:59",
      tipo: "Depurar", titulo: "nr", status: "unknown",
    });
  });

  it("q matches txn_id, integra_id, detalhes AND id_interno (numeric-guarded)", () => {
    const r = buildWhereClause({ q: "3258859", page: 1, pageSize: 25 });
    expect(r.sql).toContain("txn_id = {q:String}");
    expect(r.sql).toContain("integra_id = {q:String}");
    expect(r.sql).toContain("positionCaseInsensitive(detalhes, {q:String}) > 0");
    // numeric-guarded id_interno match so non-numeric q doesn't hit id_interno=0 rows
    expect(r.sql).toContain("toUInt64OrZero({q:String}) > 0");
    expect(r.sql).toContain("id_interno = toUInt64OrZero({q:String})");
    expect(r.params).toEqual({ q: "3258859" });
  });
});
