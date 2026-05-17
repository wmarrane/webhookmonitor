import { describe, it, expect } from "vitest";
import { buildFileStatsQuery } from "../src/repo/requestsRepo.js";

describe("buildFileStatsQuery", () => {
  it("builds a parameterized count+max(ingested_at) query for a source_file", () => {
    const q = buildFileStatsQuery("monitor", "Consultaderequestsresultados635.csv");
    expect(q.query).toContain("FROM `monitor`.requests");
    expect(q.query).toContain("count() AS rows");
    expect(q.query).toContain("toString(max(ingested_at)) AS lastIngestedAt");
    expect(q.query).toContain("WHERE source_file = {file:String}");
    expect(q.params).toEqual({ file: "Consultaderequestsresultados635.csv" });
  });
});
