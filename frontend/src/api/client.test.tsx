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

  it("importExists GETs /api/imports/exists with encoded file param", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ exists: true, rows: 5, lastIngestedAt: "2026-05-16 00:00:00" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await api.importExists("a b.csv");
    expect(r).toEqual({ exists: true, rows: 5, lastIngestedAt: "2026-05-16 00:00:00" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/imports/exists?file=a%20b.csv");
  });

  it("startImport sends replace flag in body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobId: "j1" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.startImport("x.csv", true);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body).toEqual({ file: "x.csv", replace: true });
  });

  it("startImport defaults replace=false", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobId: "j0" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.startImport("x.csv");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body).toEqual({ file: "x.csv", replace: false });
  });

  it("uploadFile appends ?replace=1 only when replace=true", async () => {
    const opened: string[] = [];
    function makeXhr() {
      return {
        upload: { addEventListener: () => {} },
        addEventListener: (k: string, cb: () => void) => { if (k === "load") setTimeout(cb, 0); },
        open: (_m: string, u: string) => opened.push(u),
        send: () => {},
        setRequestHeader: () => {},
        status: 202,
        responseText: JSON.stringify({ jobId: "j2" }),
      };
    }
    vi.stubGlobal("XMLHttpRequest", function () { return makeXhr(); } as unknown);
    const file = new File([new Uint8Array(2)], "y.csv", { type: "text/csv" });
    await api.uploadFile(file, undefined, true);
    await api.uploadFile(file, undefined, false);
    expect(opened[0]).toContain("/api/upload?replace=1");
    expect(opened[1]).toMatch(/\/api\/upload$/);
  });
});
