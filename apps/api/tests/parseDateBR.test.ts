import { describe, it, expect } from "vitest";
import { parseDateBR } from "../src/csv/parseDateBR.js";

describe("parseDateBR", () => {
  it("combines dd/MM/yyyy and H:mm into ClickHouse DateTime", () => {
    expect(parseDateBR("15/05/2026", "1:06")).toBe("2026-05-15 01:06:00");
  });

  it("zero-pads two-digit hours and minutes", () => {
    expect(parseDateBR("01/12/2025", "23:09")).toBe("2025-12-01 23:09:00");
  });

  it("returns epoch-zero string for empty/invalid input", () => {
    expect(parseDateBR("", "")).toBe("1970-01-01 00:00:00");
    expect(parseDateBR("bad", "x")).toBe("1970-01-01 00:00:00");
  });
});
