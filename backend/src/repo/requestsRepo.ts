import type { ClickHouseClient } from "@clickhouse/client";

export interface ListFilters {
  from?: string;
  to?: string;
  tipo?: string;
  titulo?: string;
  status?: string;
  q?: string;
  page: number;
  pageSize: number;
}

const SUMMARY_COLS =
  "id_interno, event_ts, nome, titulo, tipo, tipo_script, txn_id, txn_type, integra_id, status";

export function buildWhereClause(f: ListFilters): {
  sql: string;
  params: Record<string, unknown>;
} {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (f.from) {
    clauses.push("event_ts >= {from:DateTime}");
    params.from = `${f.from} 00:00:00`;
  }
  if (f.to) {
    clauses.push("event_ts <= {to:DateTime}");
    params.to = `${f.to} 23:59:59`;
  }
  if (f.tipo) {
    clauses.push("tipo = {tipo:String}");
    params.tipo = f.tipo;
  }
  if (f.titulo) {
    clauses.push("titulo = {titulo:String}");
    params.titulo = f.titulo;
  }
  if (f.status) {
    clauses.push("status = {status:String}");
    params.status = f.status;
  }
  if (f.q) {
    clauses.push(
      "(txn_id = {q:String} OR integra_id = {q:String} OR (toUInt64OrZero({q:String}) > 0 AND id_interno = toUInt64OrZero({q:String})) OR positionCaseInsensitive(detalhes, {q:String}) > 0)",
    );
    params.q = f.q;
  }
  const sql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { sql, params };
}

export class RequestsRepo {
  constructor(
    private readonly client: ClickHouseClient,
    private readonly db: string,
  ) {}

  private whereClause(f: ListFilters): {
    sql: string;
    params: Record<string, unknown>;
  } {
    return buildWhereClause(f);
  }

  async list(f: ListFilters): Promise<{
    data: unknown[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { sql, params } = this.whereClause(f);
    const offset = (f.page - 1) * f.pageSize;
    const rows = await this.client.query({
      query: `SELECT ${SUMMARY_COLS} FROM \`${this.db}\`.requests ${sql} ORDER BY event_ts DESC, id_interno DESC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
      query_params: { ...params, limit: f.pageSize, offset },
      format: "JSON",
    });
    const countRes = await this.client.query({
      query: `SELECT count() AS c FROM \`${this.db}\`.requests ${sql}`,
      query_params: params,
      format: "JSON",
    });
    const data = ((await rows.json()).data as unknown[]) ?? [];
    const countData = (await countRes.json()).data as { c: string }[];
    const c = countData[0]?.c ?? "0";
    return { data, total: Number(c), page: f.page, pageSize: f.pageSize };
  }

  async byId(id: number): Promise<unknown | null> {
    const res = await this.client.query({
      query: `SELECT * FROM \`${this.db}\`.requests WHERE id_interno = {id:UInt64} LIMIT 1`,
      query_params: { id },
      format: "JSON",
    });
    const data = (await res.json()).data as unknown[];
    return data[0] ?? null;
  }

  async byTxn(txn: string): Promise<unknown[]> {
    const res = await this.client.query({
      query: `SELECT ${SUMMARY_COLS} FROM \`${this.db}\`.requests WHERE txn_id = {txn:String} OR integra_id = {txn:String} ORDER BY event_ts ASC, id_interno ASC`,
      query_params: { txn },
      format: "JSON",
    });
    return ((await res.json()).data as unknown[]) ?? [];
  }

  async stats(f: Pick<ListFilters, "from" | "to">): Promise<{
    byDay: unknown[];
    byScript: unknown[];
    byTitulo: unknown[];
    total: number;
  }> {
    const { sql, params } = this.whereClause({
      ...f,
      page: 1,
      pageSize: 0,
    });
    const byDayRes = await this.client.query({
      query: `SELECT toDate(event_ts) AS day, count() AS total FROM \`${this.db}\`.requests ${sql} GROUP BY day ORDER BY day`,
      query_params: params,
      format: "JSON",
    });
    const byScriptRes = await this.client.query({
      query: `SELECT tipo_script, count() AS total FROM \`${this.db}\`.requests ${sql} GROUP BY tipo_script ORDER BY total DESC LIMIT 50`,
      query_params: params,
      format: "JSON",
    });
    const byTituloRes = await this.client.query({
      query: `SELECT titulo, count() AS total FROM \`${this.db}\`.requests ${sql} GROUP BY titulo ORDER BY total DESC LIMIT 50`,
      query_params: params,
      format: "JSON",
    });
    const totalsRes = await this.client.query({
      query: `SELECT count() AS total FROM \`${this.db}\`.requests ${sql}`,
      query_params: params,
      format: "JSON",
    });
    const byDay = ((await byDayRes.json()).data as unknown[]) ?? [];
    const byScript = ((await byScriptRes.json()).data as unknown[]) ?? [];
    const byTitulo = ((await byTituloRes.json()).data as unknown[]) ?? [];
    const totalsData = (await totalsRes.json()).data as { total: string }[];
    const first = totalsData[0];
    return {
      byDay,
      byScript,
      byTitulo,
      total: Number(first?.total ?? 0),
    };
  }

  async deleteByFileName(file: string): Promise<void> {
    await this.client.command({
      query: `ALTER TABLE \`${this.db}\`.requests DELETE WHERE source_file = {file:String}`,
      query_params: { file },
    });
  }

  async insertRows(rows: unknown[]): Promise<void> {
    await this.client.insert({
      table: `\`${this.db}\`.requests`,
      values: rows,
      format: "JSONEachRow",
    });
  }
}
