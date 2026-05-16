export interface ExtractedFields {
  txn_id: string;
  txn_type: string;
  integra_id: string;
}

const EMPTY: ExtractedFields = { txn_id: "", txn_type: "", integra_id: "" };

export function extractFields(detalhes: string): ExtractedFields {
  const raw = (detalhes ?? "").trim();
  if (!raw) return { ...EMPTY };
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const fields = (obj.fields ?? {}) as Record<string, unknown>;
    return {
      txn_id: str(obj.id),
      txn_type: str(obj.type),
      integra_id: str(fields.custbody_nst_integra_id_),
    };
  } catch {
    return { ...EMPTY };
  }
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}
