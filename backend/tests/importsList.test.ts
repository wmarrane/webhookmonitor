import { describe, it, expect } from "vitest";
import { buildImportsListQuery } from "../src/repo/requestsRepo.js";

describe("buildImportsListQuery", () => {
  it("builds a grouped count+max(ingested_at) query per source_file", () => {
    const q = buildImportsListQuery("monitor");
    expect(q.query).toContain("FROM `monitor`.requests");
    expect(q.query).toContain("source_file AS file");
    expect(q.query).toContain("count() AS rows");
    expect(q.query).toContain("toString(max(ingested_at)) AS lastIngestedAt");
    expect(q.query).toContain("GROUP BY source_file");
    expect(q.query).toContain("ORDER BY lastIngestedAt DESC");
    expect(q.params).toEqual({});
  });
});
