import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { P, Trip } from "../../lib/route";
import { BUS_PARTS, TAXI_PARTS, VEHICLE_Y, WALK_Y } from "./life";
import { FALLBACK_PALETTE } from "./palette";
import { createTraveler, pointAlong } from "./traveler";

const L: P[] = [
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  { x: 4, z: 3 },
];
const trip = (mode: Trip["mode"], points: P[] = L, durationSec = 7): Trip => ({ mode, points, lengthM: 175, durationSec });

describe("pointAlong", () => {
  it("handles empty, single-point and zero-length paths without NaN", () => {
    expect(pointAlong([], 0.5)).toEqual({ x: 0, z: 0, heading: 0 });
    expect(pointAlong([{ x: 2, z: 5 }], 0.5)).toEqual({ x: 2, z: 5, heading: 0 });
    const same = pointAlong([{ x: 1, z: 1 }, { x: 1, z: 1 }], 0.7);
    expect(same).toEqual({ x: 1, z: 1, heading: 0 });
  });

  it("walks a straight segment from its start to its end with the segment heading", () => {
    const seg: P[] = [{ x: 1, z: 1 }, { x: 4, z: 5 }];
    const heading = Math.atan2(4, 3);
    expect(pointAlong(seg, 0)).toMatchObject({ x: 1, z: 1 });
    expect(pointAlong(seg, 1)).toMatchObject({ x: 4, z: 5 });
    const mid = pointAlong(seg, 0.5);
    expect(mid.x).toBeCloseTo(2.5, 9);
    expect(mid.z).toBeCloseTo(3, 9);
    expect(mid.heading).toBeCloseTo(heading, 9);
  });

  it("is a constant-speed arc-length parameter over an L-shaped path", () => {
    const total = 7;
    const a = pointAlong(L, 1.75 / total);
    expect(a).toMatchObject({ x: 1.75, z: 0 });
    expect(a.heading).toBeCloseTo(0, 9);
    const corner = pointAlong(L, 4 / total);
    expect(corner.x).toBeCloseTo(4, 9);
    expect(corner.z).toBeCloseTo(0, 9);
    const b = pointAlong(L, 5.5 / total);
    expect(b.x).toBeCloseTo(4, 9);
    expect(b.z).toBeCloseTo(1.5, 9);
    expect(b.heading).toBeCloseTo(Math.PI / 2, 9);
    // equal steps in k cover equal distance on either leg
    const step = (k: number) => {
      const p = pointAlong(L, k);
      const q = pointAlong(L, k + 0.05);
      return Math.hypot(q.x - p.x, q.z - p.z);
    };
    expect(step(0.1)).toBeCloseTo(0.05 * total, 9);
    expect(step(0.7)).toBeCloseTo(0.05 * total, 9);
  });

  it("clamps progress and ignores repeated points", () => {
    expect(pointAlong(L, -3)).toMatchObject({ x: 0, z: 0 });
    expect(pointAlong(L, 9)).toMatchObject({ x: 4, z: 3 });
    expect(pointAlong(L, Number.NaN)).toMatchObject({ x: 0, z: 0 });
    const dup: P[] = [L[0], L[0], L[1], L[1], L[2], L[2]];
    const end = pointAlong(dup, 1);
    expect(end).toMatchObject({ x: 4, z: 3 });
    expect(end.heading).toBeCloseTo(Math.PI / 2, 9);
    expect(pointAlong(dup, 0).heading).toBeCloseTo(0, 9);
    expect(pointAlong(dup, 0.5).x).toBeCloseTo(pointAlong(L, 0.5).x, 9);
  });

  it("fills and returns the object it is given, so a per-frame caller allocates nothing", () => {
    const out = { x: 0, z: 0, heading: 0 };
    expect(pointAlong(L, 0.5, out)).toBe(out);
    expect(out.x).toBeCloseTo(3.5, 9);
  });
});

function setup() {
  const scene = new THREE.Scene();
  const traveler = createTraveler({ scene, palette: FALLBACK_PALETTE });
  const meshes = () => scene.children.filter((c): c is THREE.InstancedMesh => (c as THREE.Mesh).isMesh === true);
  const find = (name: string) => scene.children.find((c) => c.name === name) as THREE.InstancedMesh;
  const hex = (m: THREE.InstancedMesh, i: number) => {
    const c = new THREE.Color();
    m.getColorAt(i, c);
    return `#${c.getHexString()}`;
  };
  const worldOf = (m: THREE.InstancedMesh, i: number) => {
    const mat = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    m.getMatrixAt(i, mat);
    mat.decompose(p, q, s);
    return { p, q, s };
  };
  const figureTop = () => {
    const f = find("traveler:figure");
    let top = 0;
    for (let i = 0; i < f.count; i++) {
      const { p, s } = worldOf(f, i);
      top = Math.max(top, p.y + s.y / 2);
    }
    return top;
  };
  return { scene, traveler, meshes, find, hex, worldOf, figureTop };
}

describe("createTraveler", () => {
  it("uses at most three meshes: figure, vehicle and marker", () => {
    const { meshes, find, scene } = setup();
    expect(meshes()).toHaveLength(3);
    expect(scene.children.map((c) => c.name).sort()).toEqual(["traveler:figure", "traveler:marker", "traveler:vehicle"]);
    expect((find("traveler:figure") as THREE.InstancedMesh).count).toBe(6);
  });

  it("place() stands the 0.26-tall character in the avatar shirt with a diamond above its head", () => {
    const { traveler, find, hex, figureTop, worldOf } = setup();
    traveler.place(3, -2);
    const fig = find("traveler:figure");
    const vehicle = find("traveler:vehicle");
    const marker = find("traveler:marker") as unknown as THREE.Mesh;
    expect(fig.visible).toBe(true);
    expect(vehicle.visible).toBe(false);
    expect(marker.visible).toBe(true);
    expect(figureTop() - WALK_Y).toBeCloseTo(0.26, 6);
    expect(hex(fig, 1)).toBe(FALLBACK_PALETTE.avatar.toLowerCase());
    expect(FALLBACK_PALETTE.skin.map((c) => c.toLowerCase())).toContain(hex(fig, 0));
    expect(FALLBACK_PALETTE.pants.map((c) => c.toLowerCase())).toContain(hex(fig, 4));
    expect(((marker.material as THREE.MeshLambertMaterial).color.getHexString())).toBe(FALLBACK_PALETTE.avatar.slice(1).toLowerCase());
    expect(marker.position.y).toBeGreaterThan(figureTop());
    expect(marker.position.x).toBeCloseTo(3, 9);
    expect(marker.position.z).toBeCloseTo(-2, 9);
    // idle: legs straight, nothing swinging
    for (const k of [2, 3, 4, 5]) expect(worldOf(fig, k).q.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6);
    expect(traveler.update(1)).toMatchObject({ x: 3, z: -2, done: true });
  });

  it("walk: the character follows the points at constant speed and swings arms and legs", () => {
    const { traveler, find, worldOf } = setup();
    traveler.start(trip("walk"));
    const fig = find("traveler:figure");
    expect(fig.visible).toBe(true);
    expect(find("traveler:vehicle").visible).toBe(false);
    let s = traveler.update(3.5);
    expect(s).toMatchObject({ x: 3.5, z: 0, done: false });
    expect(s.heading).toBeCloseTo(0, 9);
    // mid-stride at some instant of the trip: the legs are rotated, opposite to each other
    let swung = false;
    const q0 = new THREE.Quaternion();
    for (let i = 0; i < 12; i++) {
      s = traveler.update(0.05);
      const l = worldOf(fig, 4).q;
      const r = worldOf(fig, 5).q;
      if (l.angleTo(q0) > 0.1 && Math.abs(l.angleTo(q0) - r.angleTo(q0)) < 0.3) swung = true;
    }
    expect(swung).toBe(true);
    s = traveler.update(0.2);
    expect(s.x).toBeCloseTo(4, 9);
    expect(s.heading).toBeCloseTo(Math.PI / 2, 9);
    s = traveler.update(10);
    expect(s).toMatchObject({ x: 4, z: 3, done: true });
  });

  it("taxi: a yellow car with a roof sign drives the points, the character is hidden and the marker rides above it", () => {
    const { traveler, find, hex, worldOf, figureTop } = setup();
    traveler.start(trip("taxi"));
    const vehicle = find("traveler:vehicle");
    const marker = find("traveler:marker") as unknown as THREE.Mesh;
    expect(find("traveler:figure").visible).toBe(false);
    expect(vehicle.visible).toBe(true);
    expect(vehicle.count).toBe(TAXI_PARTS.length);
    expect(TAXI_PARTS.length).toBeGreaterThan(12);
    expect(hex(vehicle, 0)).toBe(FALLBACK_PALETTE.taxi.toLowerCase());
    const s = traveler.update(2);
    expect(s).toMatchObject({ x: 2, z: 0, done: false });
    const body = worldOf(vehicle, 0);
    expect(body.p.x).toBeCloseTo(2, 6);
    expect(body.p.z).toBeCloseTo(0, 6);
    expect(new THREE.Vector3(1, 0, 0).applyQuaternion(body.q).x).toBeCloseTo(1, 5);
    const roof = Math.max(...Array.from({ length: vehicle.count }, (_, i) => worldOf(vehicle, i)).map(({ p, s: sc }) => p.y + sc.y / 2));
    expect(roof).toBeGreaterThan(VEHICLE_Y + 0.15);
    expect(roof).toBeLessThan(figureTop() + 0.3);
    expect(marker.visible).toBe(true);
    expect(marker.position.y).toBeGreaterThan(roof);
    expect(marker.position.x).toBeCloseTo(2, 6);
  });

  it("bus: a palette.bus bus drives the points and turns with the street", () => {
    const { traveler, find, hex, worldOf } = setup();
    traveler.start(trip("bus"));
    const vehicle = find("traveler:vehicle");
    expect(vehicle.visible).toBe(true);
    expect(vehicle.count).toBe(BUS_PARTS.length);
    expect(hex(vehicle, 0)).toBe(FALLBACK_PALETTE.bus.toLowerCase());
    const marker = find("traveler:marker") as unknown as THREE.Mesh;
    traveler.update(3.4);
    for (let i = 0; i < 40; i++) traveler.update(0.05); // past the corner at 4 u and the turn smoothing
    const s = traveler.update(0);
    expect(s.z).toBeGreaterThan(1);
    expect(s.heading).toBeCloseTo(Math.PI / 2, 9);
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(worldOf(vehicle, 0).q);
    expect(fwd.x).toBeCloseTo(0, 3);
    expect(fwd.z).toBeCloseTo(1, 3);
    expect(marker.position.y).toBeGreaterThan(VEHICLE_Y + 0.26);
  });

  it("steps out at the end of a ride: vehicle hidden, character standing at the last point", () => {
    for (const mode of ["taxi", "bus"] as const) {
      const { traveler, find } = setup();
      traveler.start(trip(mode));
      const s = traveler.update(99);
      expect(s).toMatchObject({ x: 4, z: 3, done: true });
      expect(find("traveler:vehicle").visible).toBe(false);
      const fig = find("traveler:figure");
      expect(fig.visible).toBe(true);
      const marker = find("traveler:marker") as unknown as THREE.Mesh;
      expect(marker.position.x).toBeCloseTo(4, 6);
      expect(marker.position.z).toBeCloseTo(3, 6);
    }
  });

  it("finish() jumps to the end whatever the mode, and is harmless without a trip", () => {
    const { traveler, find } = setup();
    expect(() => traveler.finish()).not.toThrow();
    for (const mode of ["walk", "taxi", "bus"] as const) {
      traveler.start(trip(mode));
      traveler.update(1);
      const s = traveler.finish();
      expect(s).toMatchObject({ x: 4, z: 3, done: true });
      expect(find("traveler:vehicle").visible).toBe(false);
      expect(find("traveler:figure").visible).toBe(true);
      expect(traveler.update(1)).toMatchObject({ x: 4, z: 3, done: true });
    }
  });

  it("returns the same state object every frame and survives bad input", () => {
    const { traveler } = setup();
    traveler.start(trip("walk"));
    const a = traveler.update(0.1);
    expect(traveler.update(0.1)).toBe(a);
    const x = a.x;
    traveler.update(Number.NaN);
    traveler.update(-5);
    expect(a.x).toBe(x);
    expect(Number.isFinite(a.heading)).toBe(true);
    // a trip with no length or no time ends where it begins
    traveler.start({ mode: "walk", points: [{ x: 1, z: 1 }], lengthM: 0, durationSec: 0 });
    expect(traveler.update(0.1)).toMatchObject({ x: 1, z: 1, done: true });
    traveler.start({ mode: "taxi", points: L, lengthM: 175, durationSec: 0 });
    expect(traveler.update(0.1)).toMatchObject({ x: 4, z: 3, done: true });
    traveler.start({ mode: "bus", points: [], lengthM: 0, durationSec: 3 });
    expect(Number.isFinite(traveler.update(0.1).x)).toBe(true);
  });

  it("places and re-starts cleanly between trips", () => {
    const { traveler, find } = setup();
    traveler.start(trip("taxi"));
    traveler.update(2);
    traveler.place(-1, 1);
    expect(find("traveler:vehicle").visible).toBe(false);
    expect(find("traveler:figure").visible).toBe(true);
    expect(traveler.update(1)).toMatchObject({ x: -1, z: 1, done: true });
    traveler.start(trip("walk"));
    expect(traveler.update(0)).toMatchObject({ x: 0, z: 0, done: false });
  });

  it("dispose() removes every mesh and frees geometry and materials, once", () => {
    const { scene, traveler, meshes } = setup();
    let disposed = 0;
    for (const m of meshes()) {
      m.geometry.addEventListener("dispose", () => disposed++);
      (m.material as THREE.Material).addEventListener("dispose", () => disposed++);
    }
    traveler.start(trip("taxi"));
    traveler.dispose();
    expect(scene.children).toHaveLength(0);
    expect(disposed).toBe(6);
    expect(() => {
      traveler.dispose();
      traveler.update(1);
      traveler.place(0, 0);
      traveler.finish();
    }).not.toThrow();
    expect(disposed).toBe(6);
  });

  it("updates in well under a millisecond", () => {
    const { traveler } = setup();
    const long: P[] = Array.from({ length: 200 }, (_, i) => ({ x: i * 0.3, z: (i % 2) * 0.3 }));
    for (const mode of ["walk", "taxi", "bus"] as const) {
      traveler.start(trip(mode, long, 8));
      for (let i = 0; i < 20; i++) traveler.update(0.016);
      const t0 = performance.now();
      for (let i = 0; i < 300; i++) traveler.update(0.016);
      expect((performance.now() - t0) / 300).toBeLessThan(1);
    }
  });
});
