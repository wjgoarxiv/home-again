import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { planAgents, type Spot, type Street } from "../../lib/life";
import { BUS_PARTS, CAR_PARTS, FIGURE_HEIGHT, FIGURE_PARTS, VEHICLE_Y, WALK_Y, createLife, poseFigure, type VehiclePart } from "./life";
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
const extent = (parts: VehiclePart[]) => {
  const lo = (f: (q: VehiclePart) => number) => Math.min(...parts.map(f));
  const hi = (f: (q: VehiclePart) => number) => Math.max(...parts.map(f));
  return {
    length: hi((q) => q.ox + q.sx / 2) - lo((q) => q.ox - q.sx / 2),
    width: hi((q) => q.oz + q.sz / 2) - lo((q) => q.oz - q.sz / 2),
    height: hi((q) => q.oy + q.sy / 2),
    bottom: lo((q) => q.oy - q.sy / 2),
  };
};

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

  it("is a 0.42 x 0.2 x 0.15 car that rotates to the heading on both axes and directions", () => {
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
      expect(s.x).toBeCloseTo(0.42, 3);
      expect(s.y).toBeCloseTo(0.07, 3);
      expect(s.z).toBeCloseTo(0.2, 3);
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

  it("rests on the road and stays well below the 1.6-unit buildings (about 0.44 x 0.23 x 0.15 overall)", () => {
    const e = extent(CAR_PARTS);
    expect(e.length).toBeGreaterThan(0.4);
    expect(e.length).toBeLessThan(0.46);
    expect(e.width).toBeGreaterThan(0.2);
    expect(e.width).toBeLessThan(0.25);
    expect(e.height).toBeCloseTo(0.15, 3);
    expect(e.bottom).toBeCloseTo(0, 6);
    const { scene } = setup(1);
    const wheels = named(scene, "cars:wheels")[0];
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    wheels.getMatrixAt(0, m);
    p.setFromMatrixPosition(m);
    expect(p.y - 0.03).toBeCloseTo(VEHICLE_Y, 6);
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
      expect(out).toBeGreaterThanOrEqual(0.2 / 2 - 1e-6); // wheel centre sits at the body side
      expect(hex(wheels, k)).toBe(FALLBACK_PALETTE.wheel.toLowerCase());
    }
    const wm = new THREE.Matrix4();
    wheels.getMatrixAt(0, wm);
    const ws = new THREE.Vector3();
    wm.decompose(wp, q, ws);
    expect(Math.max(...reach) / 100 + ws.z / 2).toBeGreaterThan(0.2 / 2 + 0.01);
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

describe("createLife buses", () => {
  it("draws a body, a window band and wheels per bus, painted palette.bus", () => {
    const { scene } = setup(1);
    const buses = planAgents(STREETS, SPOTS, SEED, 1).filter((a) => a.kind === "bus");
    expect(buses.length).toBeGreaterThan(0);
    expect(buses.length).toBeLessThanOrEqual(6);
    const by = Object.fromEntries(named(scene, "buses:").map((m) => [m.name, m]));
    expect(Object.keys(by).sort()).toEqual(["buses:body", "buses:glass", "buses:wheels"]);
    expect(by["buses:body"].count).toBe(buses.length);
    expect(by["buses:wheels"].count).toBe(buses.length * 4);
    expect(by["buses:glass"].count).toBe(buses.length * 8);
    for (let i = 0; i < buses.length; i++) expect(hex(by["buses:body"], i)).toBe(FALLBACK_PALETTE.bus.toLowerCase());
  });

  it("is about 1.0 long x 0.24 wide x 0.26 tall and at most 6 at density 1; none at density 0", () => {
    const e = extent(BUS_PARTS);
    expect(e.length).toBeGreaterThan(0.98);
    expect(e.length).toBeLessThan(1.05);
    expect(e.width).toBeGreaterThan(0.24);
    expect(e.width).toBeLessThan(0.28);
    expect(e.height).toBeCloseTo(0.26, 3);
    const { scene } = setup(1);
    const body = named(scene, "buses:body")[0];
    const m = new THREE.Matrix4();
    const s = new THREE.Vector3();
    body.getMatrixAt(0, m);
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    expect(s.x).toBeCloseTo(1.0, 3);
    expect(s.z).toBeCloseTo(0.24, 3);
    expect(named(setup(0).scene, "buses:")).toHaveLength(0);
  });
});

describe("poseFigure", () => {
  const identity = new THREE.Quaternion();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), FIGURE_PARTS);
  const part = (k: number) => {
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    mesh.getMatrixAt(k, m);
    m.decompose(p, q, s);
    const foot = new THREE.Vector3(0, -s.y / 2, 0).applyQuaternion(q).add(p);
    return { p, q, s, foot };
  };

  it("stands 0.2 tall from the ground with a head, torso, two arms and two legs", () => {
    poseFigure(mesh, 0, 1, WALK_Y, 2, identity, 0);
    expect(FIGURE_PARTS).toBe(6);
    expect(FIGURE_HEIGHT).toBeCloseTo(0.2, 9);
    const parts = Array.from({ length: 6 }, (_, k) => part(k));
    const top = Math.max(...parts.map(({ p, s }) => p.y + s.y / 2));
    const bottom = Math.min(...parts.map(({ p, s }) => p.y - s.y / 2));
    expect(top - WALK_Y).toBeCloseTo(0.2, 6);
    expect(bottom).toBeCloseTo(WALK_Y, 6);
    const [head, torso, armL, armR, legL, legR] = parts;
    expect(head.p.y).toBeGreaterThan(torso.p.y);
    expect(torso.p.y).toBeGreaterThan(legL.p.y);
    expect(armL.p.z).toBeLessThan(torso.p.z);
    expect(armR.p.z).toBeGreaterThan(torso.p.z);
    expect(legL.p.z).toBeLessThan(legR.p.z);
    expect(armL.p.x).toBeCloseTo(1, 6);
    for (const { s } of parts) expect(Math.max(s.x, s.y, s.z)).toBeLessThanOrEqual(0.08);
    // the whole figure is a blocky 0.1 wide (arm tip to arm tip), not a stick
    expect(Math.max(...parts.map(({ p, s }) => p.z + s.z / 2)) - Math.min(...parts.map(({ p, s }) => p.z - s.z / 2))).toBeGreaterThan(0.09);
  });

  it("swings opposite legs and arms about the hips and shoulders, hanging from fixed pivots", () => {
    poseFigure(mesh, 0, 0, 0, 0, identity, 0);
    const rest = Array.from({ length: 6 }, (_, k) => part(k));
    poseFigure(mesh, 0, 0, 0, 0, identity, 0.5);
    const [, , armL, armR, legL, legR] = Array.from({ length: 6 }, (_, k) => part(k));
    expect(legL.foot.x).toBeGreaterThan(0.02);
    expect(legR.foot.x).toBeLessThan(-0.02);
    expect(armL.foot.x).toBeLessThan(-0.02); // left arm swings against the left leg
    expect(armR.foot.x).toBeGreaterThan(0.02);
    // the hip end of each limb stays put
    for (const k of [2, 3, 4, 5]) {
      const now = part(k);
      const top = new THREE.Vector3(0, now.s.y / 2, 0).applyQuaternion(now.q).add(now.p);
      const was = new THREE.Vector3(0, rest[k].s.y / 2, 0).add(rest[k].p);
      expect(top.distanceTo(was)).toBeLessThan(1e-6);
    }
    // head and torso never swing
    expect(part(0).q.angleTo(identity)).toBeCloseTo(0, 9);
    expect(part(1).q.angleTo(identity)).toBeCloseTo(0, 9);
  });

  it("turns the whole figure with the heading yaw", () => {
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    poseFigure(mesh, 0, 0, 0, 0, yaw, 0.5);
    // yaw pi/2 maps local +x to world -z, so a leg swung forward ends up at negative z
    expect(part(4).foot.z).toBeLessThan(-0.02);
    expect(Math.abs(part(4).foot.x - part(4).p.x)).toBeLessThan(0.03);
  });
});

describe("createLife people", () => {
  it("draws six boxes per pedestrian in one mesh, from the skin, shirt and pants palettes", () => {
    const { scene, peds } = setup(1);
    expect(peds.length).toBeGreaterThan(0);
    expect(named(scene, "people:")).toHaveLength(1);
    const mesh = named(scene, "people:")[0];
    expect(mesh.count).toBe(peds.length * 6);
    const skin = new Set(lower(FALLBACK_PALETTE.skin));
    const shirts = new Set(lower(FALLBACK_PALETTE.shirts));
    const pants = new Set(lower(FALLBACK_PALETTE.pants));
    const tones = new Set<string>();
    let bare = 0;
    for (let i = 0; i < peds.length; i++) {
      const [head, torso, armL, armR, legL, legR] = Array.from({ length: 6 }, (_, k) => hex(mesh, i * 6 + k));
      expect(skin.has(head)).toBe(true);
      expect(shirts.has(torso)).toBe(true);
      expect(armL).toBe(armR);
      expect(armL === head || armL === torso).toBe(true);
      if (armL === head && armL !== torso) bare++;
      expect(pants.has(legL)).toBe(true);
      expect(legR).toBe(legL);
      tones.add(`${head}${torso}${legL}`);
    }
    expect(tones.size).toBeGreaterThan(5);
    expect(bare).toBeGreaterThan(0);
    expect(bare).toBeLessThan(peds.length);
  });

  it("stands about 0.2 tall on the sidewalk and keeps every limb moving only while walking", () => {
    const { scene, life, peds } = setup(1);
    const mesh = named(scene, "people:")[0];
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    let top = 0;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      m.decompose(p, new THREE.Quaternion(), s);
      top = Math.max(top, p.y + s.y / 2);
    }
    expect(top).toBeGreaterThan(0.18);
    expect(top).toBeLessThan(0.23);
    const snapshot = () => Array.from(mesh.instanceMatrix.array as Float32Array);
    const before = snapshot();
    for (let i = 0; i < 20; i++) life.update(0.05);
    const after = snapshot();
    let changed = 0;
    for (let i = 0; i < peds.length; i++) {
      // legs are instances 4 and 5: their rotation elements change while the figure walks
      const a = before.slice((i * 6 + 4) * 16, (i * 6 + 4) * 16 + 16);
      const b = after.slice((i * 6 + 4) * 16, (i * 6 + 4) * 16 + 16);
      if (a.some((v, k) => Math.abs(v - b[k]) > 1e-5)) changed++;
    }
    expect(changed).toBeGreaterThan(peds.length / 2);
  });
});
