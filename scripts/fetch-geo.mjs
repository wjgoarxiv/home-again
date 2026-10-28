// Fetches NYC Open Data building footprints and street centerlines once per demo neighbourhood
// and writes compact snapshots to public/geo/<slug>.json. Run by hand: `node scripts/fetch-geo.mjs`.
// Sources (no key needed): Building Footprints 5zhs-2jue, Street Centerline (CSCL) inkn-q76z.
import { mkdir, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { estimateGridTheta, projectM, rotateToGrid, simplifyRing } from "../lib/geomap.ts";

const AREAS = [
  { name: "East Village, New York", lat: 40.726111111111, lng: -73.981388888889 },
  { name: "Williamsburg, Brooklyn", lat: 40.7142, lng: -73.9614 },
  { name: "West Village, New York", lat: 40.7358, lng: -74.0036 },
];
const RADIUS_M = 1500;
const BASE = "https://data.cityofnewyork.us/resource";
const OUT = fileURLToPath(new URL("../public/geo/", import.meta.url));

export const slugOf = (name) => name.split(",")[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");

async function soda(dataset, params) {
  const url = `${BASE}/${dataset}.geojson?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${dataset}: HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json.features)) throw new Error(`${dataset}: no features array`);
  return json.features;
}

const polys = (geom) => (geom?.type === "MultiPolygon" ? geom.coordinates : geom?.type === "Polygon" ? [geom.coordinates] : []);
const lines = (geom) => (geom?.type === "MultiLineString" ? geom.coordinates : geom?.type === "LineString" ? [geom.coordinates] : []);
const dm = (m) => Math.round(m * 10);

async function snapshot(area) {
  const circle = (r) => `within_circle(the_geom, ${area.lat}, ${area.lng}, ${r})`;
  const [bFeatures, sFeatures] = [
    await soda("5zhs-2jue", {
      $select: "bin,height_roof,feature_code,the_geom",
      $where: `${circle(RADIUS_M)} AND feature_code in('2100','5110')`,
      $limit: "50000",
    }),
    await soda("inkn-q76z", {
      $select: "number_travel_lanes,the_geom",
      $where: `${circle(RADIUS_M + 200)} AND rw_type='1'`,
      $limit: "50000",
    }),
  ];

  const toM = ([lng, lat]) => projectM(area, lng, lat);
  const streetLines = sFeatures.flatMap((f) =>
    lines(f.geometry).map((line) => ({ l: Math.max(1, Math.min(4, Number(f.properties?.number_travel_lanes) || 1)), pts: line.map(toM) })),
  );
  const segs = streetLines.flatMap(({ pts }) => pts.slice(1).map((p, i) => [pts[i].x, pts[i].z, p.x, p.z]));
  // The local grid near the centre decides the angle: wider circles mix in other grids (Williamsburg, West Village).
  const near = segs.filter(([x1, z1, x2, z2]) => Math.hypot((x1 + x2) / 2, (z1 + z2) / 2) < 500);
  const theta = estimateGridTheta(near.length ? near : segs);
  const rot = (p) => rotateToGrid(p.x, p.z, theta);

  const buildings = [];
  for (const f of bFeatures) {
    const feet = Number.parseFloat(f.properties?.height_roof ?? "");
    const h = Number.isFinite(feet) && feet > 0 ? dm(feet * 0.3048) : 0;
    for (const poly of polys(f.geometry)) {
      const rings = [];
      for (const ring of poly) {
        const simple = simplifyRing(ring.map(toM).map(rot).map((p) => [p.x, p.z]), 0.6);
        if (simple) rings.push(simple.flatMap(([x, z]) => [dm(x), dm(z)]));
        else if (!rings.length) break;
      }
      if (!rings.length) continue;
      const outer = rings[0];
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < outer.length; i += 2) {
        cx += outer[i];
        cz += outer[i + 1];
      }
      const n = outer.length / 2;
      if (Math.hypot(cx / n, cz / n) / 10 > RADIUS_M) continue;
      buildings.push({ h, rings });
    }
  }

  const streets = streetLines
    .map(({ l, pts }) => ({ l, p: pts.map(rot).flatMap((p) => [dm(p.x), dm(p.z)]) }))
    .filter(({ p }) => p.length >= 4);

  return {
    meta: {
      area: area.name,
      source: "NYC Open Data: Building Footprints (5zhs-2jue), Street Centerline (inkn-q76z)",
      retrieved: new Date().toISOString().slice(0, 10),
      theta: Math.round(theta * 100) / 100,
      radiusM: RADIUS_M,
      scale: "dm",
    },
    buildings,
    streets,
  };
}

await mkdir(OUT, { recursive: true });
for (const area of AREAS) {
  const slug = slugOf(area.name);
  try {
    const snap = await snapshot(area);
    const body = JSON.stringify(snap);
    const tmp = `${OUT}${slug}.json.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, `${OUT}${slug}.json`);
    const tall = snap.buildings.reduce((m, b) => Math.max(m, b.h), 0) / 10;
    console.log(
      `${slug}: buildings=${snap.buildings.length} streets=${snap.streets.length} theta=${snap.meta.theta} bytes=${body.length} tallest=${tall}m`,
    );
  } catch (err) {
    console.error(`${slug}: FAILED ${err instanceof Error ? err.message : err} (existing file left untouched)`);
    process.exitCode = 1;
  }
}
