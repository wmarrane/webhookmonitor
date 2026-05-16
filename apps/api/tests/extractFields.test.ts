import { describe, it, expect } from "vitest";
import { extractFields } from "../src/csv/extractFields.js";

describe("extractFields", () => {
  it("extracts id, type and integra_id from a valid payload", () => {
    const json = JSON.stringify({
      id: "360738",
      type: "invoice",
      fields: { custbody_nst_integra_id_: "38967664" },
    });
    expect(extractFields(json)).toEqual({
      txn_id: "360738",
      txn_type: "invoice",
      integra_id: "38967664",
    });
  });

  it("returns empty strings for empty detalhes", () => {
    expect(extractFields("")).toEqual({
      txn_id: "",
      txn_type: "",
      integra_id: "",
    });
  });

  it("returns empty strings for invalid JSON without throwing", () => {
    expect(extractFields("{not json")).toEqual({
      txn_id: "",
      txn_type: "",
      integra_id: "",
    });
  });

  it("tolerates missing fields object", () => {
    expect(extractFields(JSON.stringify({ id: "9", type: "x" }))).toEqual({
      txn_id: "9",
      txn_type: "x",
      integra_id: "",
    });
  });
});
