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

  it("uploadFile posts multipart and resolves jobId, reporting progress", async () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const xhrMock = {
      upload: { addEventListener: (k: string, cb: (e: unknown) => void) => { listeners["up_" + k] = cb; } },
      addEventListener: (k: string, cb: (e: unknown) => void) => { listeners[k] = cb; },
      open: vi.fn(),
      send: vi.fn(function (this: unknown) {
        listeners["up_progress"]({ lengthComputable: true, loaded: 5, total: 10 });
        Object.assign(xhrMock, { status: 202, responseText: JSON.stringify({ jobId: "job-9" }) });
        listeners["load"]({});
      }),
      setRequestHeader: vi.fn(),
      status: 0,
      responseText: "",
    };
    vi.stubGlobal("XMLHttpRequest", function () { return xhrMock; } as unknown);

    const seen: number[] = [];
    const file = new File([new Uint8Array(10)], "x.csv", { type: "text/csv" });
    const jobId = await api.uploadFile(file, (p) => seen.push(p.loaded / p.total));
    expect(jobId).toBe("job-9");
    expect(seen).toContain(0.5);
  });
});
