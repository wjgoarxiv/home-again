import { describe, expect, it, vi } from "vitest";
import fixture from "@/test/fixtures/insights.synthetic.json";
import { QlooError, buildInsightsParams, parseCandidates, qlooGet, sharedTaste } from "./qloo";

const area = { name: "East Village", lat: 40.726111, lng: -73.981389 };

describe("buildInsightsParams", () => {
  it("encodes location as WKT POINT(lng lat) with a metre radius and café genres", () => {
    const p = buildInsightsParams({ area, radiusM: 700, signalIds: ["A", "B"], excludeIds: ["X"], take: 15 });
    expect(p["filter.type"]).toBe("urn:entity:place");
    expect(p["filter.location"]).toBe("POINT(-73.981389 40.726111)");
    expect(p["filter.location.radius"]).toBe("700");
    expect(p["filter.tags"]).toContain("urn:tag:genre:place:restaurant:coffee_shop");
    expect(p["signal.interests.entities"]).toBe("A,B");
    expect(p["filter.exclude.entities"]).toBe("X");
    expect(p.take).toBe("15");
  });

  it("omits exclusion when there is nothing to exclude", () => {
    const p = buildInsightsParams({ area, radiusM: 1000, signalIds: ["A"], excludeIds: [], take: 10 });
    expect(p).not.toHaveProperty("filter.exclude.entities");
  });
});

describe("parseCandidates", () => {
  const candidates = parseCandidates(fixture, area, 1000);

  it("keeps entities inside the radius with distance, affinity and taste tag names", () => {
    expect(candidates.map((c) => c.id)).toEqual(["TEST-0001", "TEST-0002"]);
    expect(candidates[0]).toMatchObject({ name: "Test Roasters", affinity: 0.91, address: "1 Example St, New York, NY" });
    // genre, payment and customer-identity tags are not taste signals; duplicates collapse
    expect(candidates[0].tags).toEqual(["Espresso", "Light Roast", "Minimalist"]);
    expect(candidates[0].distanceM).toBeGreaterThan(0);
    expect(candidates[0].distanceM).toBeLessThan(1000);
  });

  it("rejects a response without an entity list", () => {
    expect(() => parseCandidates({ success: false }, area, 1000)).toThrow(QlooError);
  });
});

describe("sharedTaste", () => {
  it("returns tags the candidate shares with the seed, ignoring generic genres", () => {
    expect(sharedTaste(["Cafe", "Espresso", "Roastery"], ["Espresso", "Roastery", "Cafe", "Bakery"])).toEqual(["Espresso", "Roastery"]);
  });
});

describe("qlooGet", () => {
  const env = { baseUrl: "https://example.test", apiKey: "k" };

  it("maps 401 to auth and 429 to quota without retrying", async () => {
    const f401 = vi.fn(async () => new Response("no", { status: 401 }));
    await expect(qlooGet("/v2/insights", {}, env, f401)).rejects.toMatchObject({ kind: "auth" });
    const f429 = vi.fn(async () => new Response("slow", { status: 429 }));
    await expect(qlooGet("/v2/insights", {}, env, f429)).rejects.toMatchObject({ kind: "quota" });
    expect(f429).toHaveBeenCalledTimes(1);
  });

  it("sends the key only as a header", async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true }));
    await qlooGet("/search", { query: "x" }, env, f);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://example.test/search?query=x");
    expect((init?.headers as Record<string, string>)["X-Api-Key"]).toBe("k");
  });
});
