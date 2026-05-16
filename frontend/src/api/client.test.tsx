import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "./client.js";

afterEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("GETs JSON from the configured base url", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ name: "a.csv" }]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const files = await api.files();
    expect(files).toEqual([{ name: "a.csv" }]);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/files");
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );
    await expect(api.files()).rejects.toThrow();
  });
});
