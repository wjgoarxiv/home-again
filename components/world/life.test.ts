import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { planAgents, type Spot, type Street } from "../../lib/life";
import { createLife } from "./life";
import { FALLBACK_PALETTE } from "./palette";

const STREETS: Street[] = [
  { x: -18, z: -3, dir: "x", length: 36, lanes: 2 },
  { x: -3, z: -18, dir: "z", length: 36, lanes: 2 },
  { x: -18, z: 3, dir: "x", length: 36, lanes: 1 },
];
const SPOTS: Spot[] = [{ id: "t1", x: 6, z: 6, height: 5 }];
const SEED = 99;

const instanced = (scene: THREE.Scene) => scene.children.filter((c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh);
const named = (scene: THREE.Scene, prefix: string) => instanced(scene).filter((m) => m.name.startsWith(prefix));
const hex = (m: THREE.InstancedMesh, i: number) => {
  const c = new THREE.Color();
  m.getColorAt(i, c);
  return `#${c.getHexString()}`;
};
const lower = (list: string[]) => list.map((s) => s.toLowerCase());

function setup(density: number) {
  const scene = new THREE.Scene();
  const life = createLife({ scene, streets: STREETS, spots: SPOTS, seed: SEED, density, palette: FALLBACK_PALETTE });
  life.update(0.05);
  const cars = planAgents(STREETS, SPOTS, SEED, density).filter((a) => a.kind === "car");
  const peds = planAgents(STREETS, SPOTS, SEED, density).filter((a) => a.kind === "ped");
  return { scene, life, cars, peds };
}

describe("createLife cars", () => {
  it("uses three instanced meshes for every car part", () => {
    const { scene, cars } = setup(1);
    expect(cars.length).toBeGreaterThan(0);
    const parts = named(scene, "cars:");
    expect(parts.map((m) => m.name).sort()).toEqual(["cars:body", "cars:glass", "cars:wheels"]);
    const by = Object.fromEntries(parts.map((m) => [m.name, m.count]));
    expect(by["cars:body"]).toBe(cars.length);
    expect(by["cars:wheels"]).toBe(cars.length * 4);
    expect(by["cars:glass"]).toBe(cars.length * 7);
  });

  it("makes no car or pedestrian meshes at density 0 and never throws", () => {
    const { scene, life } = setup(0);
    expect(named(scene, "cars:")).toHaveLength(0);
    expect(named(scene, "people:")).toHaveLength(0);
    expect(() => {
      life.update(0.1);
      life.dispose();
    }).not.toThrow();
  });

  it("paints bodies only from palette.cars", () => {
    const { scene, cars } = setup(1);
    const body = named(scene, "cars:body")[0];
    const allowed = new Set(lower(FALLBACK_PALETTE.cars));
    for (let i = 0; i < cars.length; i++) expect(allowed.has(hex(body, i))).toBe(true);
    expect(new Set(Array.from({ length: cars.length }, (_, i) => hex(body, i))).size).toBeGreaterThan(2);
  });

  it("is about 2.0 x 0.6 x 0.95 and rotates to the heading on both axes and directions", () => {
    const { scene, cars } = setup(1);
    const body = named(scene, "cars:body")[0];
    const glass = named(scene, "cars:glass")[0];
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const combos = new Set<string>();
    cars.forEach((a, i) => {
      if (a.kind !== "car") return;
      body.getMatrixAt(i, m);
      m.decompose(p, q, s);
      expect(s.x).toBeCloseTo(2.0, 1);
      expect(s.y).toBeCloseTo(0.6, 1);
      expect(s.z).toBeCloseTo(0.95, 1);
      const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const wantX = a.axis === "x" ? a.dir : 0;
      const wantZ = a.axis === "z" ? a.dir : 0;
      // planAgents' state is pre-update; one 0.05 s step may only have flipped a U-turn at an end, so allow either sign only when not mid-street.
      if (a.s > 0.5 && a.s < a.len - 0.5) {
        expect(fwd.x).toBeCloseTo(wantX, 5);
        expect(fwd.z).toBeCloseTo(wantZ, 5);
        // headlights (glass 3,4) ahead of the body centre, taillights (5,6) behind
        const probe = new THREE.Matrix4();
        const hp = new THREE.Vector3();
        for (const [k, sign, want] of [[3, 1, FALLBACK_PALETTE.headlight], [4, 1, FALLBACK_PALETTE.headlight], [5, -1, FALLBACK_PALETTE.taillight], [6, -1, FALLBACK_PALETTE.taillight]] as const) {
          glass.getMatrixAt(i * 7 + k, probe);
          hp.setFromMatrixPosition(probe);
          const ahead = (hp.x - p.x) * fwd.x + (hp.z - p.z) * fwd.z;
          expect(Math.sign(ahead)).toBe(sign);
          expect(hex(glass, i * 7 + k)).toBe(want.toLowerCase());
        }
      }
      combos.add(`${a.axis}${a.dir}`);
    });
    expect(combos.size).toBe(4);
  });

  it("puts four dark wheels slightly proud of the body sides", () => {
    const { scene } = setup(1);
    const body = named(scene, "cars:body")[0];
    const wheels = named(scene, "cars:wheels")[0];
    const m = new THREE.Matrix4();
    const bp = new THREE.Vector3();
    const wp = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    body.getMatrixAt(0, m);
    m.decompose(bp, q, s);
    const side = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const reach = new Set<number>();
    for (let k = 0; k < 4; k++) {
      wheels.getMatrixAt(k, m);
      wp.setFromMatrixPosition(m);
      const out = Math.abs((wp.x - bp.x) * side.x + (wp.z - bp.z) * side.z);
      reach.add(Math.round(out * 100));
      expect(out + 0.1).toBeGreaterThan(0.95 / 2); // wheel centre sits near/at the body side
      expect(hex(wheels, k)).toBe(FALLBACK_PALETTE.wheel.toLowerCase());
    }
    const wm = new THREE.Matrix4();
    wheels.getMatrixAt(0, wm);
    const ws = new THREE.Vector3();
    wm.decompose(wp, q, ws);
    expect(Math.max(...reach) / 100 + ws.z / 2).toBeGreaterThan(0.95 / 2 + 0.05);
  });

  it("updates in under 2 ms at density 1", () => {
    const scene = new THREE.Scene();
    const big: Street[] = Array.from({ length: 12 }, (_, i) => ({ x: -18, z: -15 + i * 3, dir: "x", length: 36, lanes: (i % 2 ? 1 : 2) as 1 | 2 }));
    const life = createLife({ scene, streets: big, spots: SPOTS, seed: SEED, density: 1, palette: FALLBACK_PALETTE });
    for (let i = 0; i < 20; i++) life.update(0.016);
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) life.update(0.016);
    expect((performance.now() - t0) / 200).toBeLessThan(2);
  });
});

describe("createLife people", () => {
  it("draws a two-part figure per pedestrian in palette.people with a different head tone", () => {
    const { scene, peds } = setup(1);
    expect(peds.length).toBeGreaterThan(0);
    const mesh = named(scene, "people:")[0];
    expect(named(scene, "people:").length).toBeLessThanOrEqual(2);
    expect(mesh.count).toBe(peds.length * 2);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const allowed = new Set(lower(FALLBACK_PALETTE.people));
    let top = 0;
    for (let i = 0; i < peds.length; i++) {
      expect(allowed.has(hex(mesh, i * 2))).toBe(true);
      expect(hex(mesh, i * 2 + 1)).not.toBe(hex(mesh, i * 2));
      mesh.getMatrixAt(i * 2, m);
      m.decompose(p, q, s);
      const bodyTop = p.y + s.y / 2;
      expect(Math.max(s.x, s.z)).toBeLessThanOrEqual(0.4);
      mesh.getMatrixAt(i * 2 + 1, m);
      m.decompose(p, q, s);
      top = Math.max(top, p.y + s.y / 2);
      expect(p.y - s.y / 2).toBeGreaterThanOrEqual(bodyTop - 0.05);
    }
    expect(top).toBeGreaterThan(1.0);
    expect(top).toBeLessThan(1.3);
  });
});
