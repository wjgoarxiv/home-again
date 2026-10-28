import { describe, expect, it, vi } from "vitest";
import { LimitError, budgeted, memoryStore, requestKey } from "./limits";

const caps = { session: 2, daily: 3 };

describe("requestKey", () => {
  it("ignores parameter order", () => {
    expect(requestKey({ b: "2", a: "1" })).toBe(requestKey({ a: "1", b: "2" }));
  });
});

describe("budgeted", () => {
  it("serves a repeated request from cache with one upstream call", async () => {
    const store = memoryStore();
    const fetcher = vi.fn(async () => ({ ok: 1 }));
    await budgeted(store, "s1", "k", fetcher, caps);
    const second = await budgeted(store, "s1", "k", fetcher, caps);
    expect(second).toEqual({ ok: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("stops a session at its cap", async () => {
    const store = memoryStore();
    const fetcher = async () => 1;
    await budgeted(store, "s1", "k1", fetcher, caps);
    await budgeted(store, "s1", "k2", fetcher, caps);
    await expect(budgeted(store, "s1", "k3", fetcher, caps)).rejects.toBeInstanceOf(LimitError);
  });

  it("stops everyone at the daily cap", async () => {
    const store = memoryStore();
    const fetcher = async () => 1;
    await budgeted(store, "s1", "k1", fetcher, caps);
    await budgeted(store, "s2", "k2", fetcher, caps);
    await budgeted(store, "s3", "k3", fetcher, caps);
    await expect(budgeted(store, "s4", "k4", fetcher, caps)).rejects.toMatchObject({ scope: "daily" });
  });

  it("still serves cached answers after the cap is reached", async () => {
    const store = memoryStore();
    const fetcher = async () => "v";
    await budgeted(store, "s1", "k1", fetcher, caps);
    await budgeted(store, "s1", "k2", fetcher, caps);
    await expect(budgeted(store, "s1", "k1", fetcher, caps)).resolves.toBe("v");
  });

  it("does not cache a failed upstream call", async () => {
    const store = memoryStore();
    const failing = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(budgeted(store, "s1", "k", failing, caps)).rejects.toThrow("boom");
    const ok = vi.fn(async () => "fine");
    await expect(budgeted(store, "s1", "k", ok, caps)).resolves.toBe("fine");
  });
});
