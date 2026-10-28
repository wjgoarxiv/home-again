import * as THREE from "three";
import { gaitSwing, headingOf, planAgents, stepAgent, writePosition, type Agent, type Spot, type Street } from "../../lib/life";
import { FALLBACK_PALETTE, type WorldPalette } from "./palette";

export type LifePalette = WorldPalette;

/** The pre-round-5 input shape; still accepted so an unwired host keeps compiling (cars then use `car`). */
export type LegacyLifePalette = { car: string[]; person: string[]; steam: string; bird: string };

export type CreateLifeOptions = {
  scene: THREE.Scene;
  streets: Street[];
  spots: Spot[];
  seed: number;
  density: number;
  palette: LifePalette | LegacyLifePalette;
};

export type LifeHandle = {
  update(dtSec: number): void;
  setSpots(spots: Spot[]): void;
  dispose(): void;
};

const STEAM_PUFFS = 3;
const STEAM_RISE = 2.2;
// Traffic signal post: tall enough to read over the 0.15-high cars.
const SIGNAL_W = 0.06;
const SIGNAL_H = 0.3;
// Birds are about as long as a bus now that cars are 0.42, instead of the 7 m wingspan they had at the old scale.
const BIRD = { x: 0.14, y: 0.09, z: 0.16 };

/** Scene units: road ribbons sit at y 0.03 and sidewalk strips at 0.015 (realTown.ts), so wheels and shoes rest just above them. */
export const VEHICLE_Y = 0.035;
export const WALK_Y = 0.02;

export type Part = { ox: number; oy: number; oz: number; sx: number; sy: number; sz: number };
export type Role = "body" | "glass" | "dark" | "head" | "tail" | "wheel";
export type VehiclePart = Part & { role: Role };
const vp = (role: Role, ox: number, oy: number, oz: number, sx: number, sy: number, sz: number): VehiclePart => ({ role, ox, oy, oz, sx, sy, sz });

// Vehicle-local frame: +x is the direction of travel, +z the right-hand side, y up, y = 0 on the road.
// Car: 0.42 long x 0.2 wide x 0.15 tall, about twice a real car so it matches the 2.5x-exaggerated buildings.
export const CAR_PARTS: VehiclePart[] = [
  vp("body", 0, 0.065, 0, 0.42, 0.07, 0.2),
  vp("glass", -0.02, 0.125, 0, 0.22, 0.05, 0.17), // cabin
  vp("dark", 0.095, 0.13, 0, 0.02, 0.04, 0.15), // windshield band
  vp("dark", -0.135, 0.13, 0, 0.02, 0.04, 0.15), // rear-window band
  vp("head", 0.21, 0.075, 0.065, 0.02, 0.03, 0.045),
  vp("head", 0.21, 0.075, -0.065, 0.02, 0.03, 0.045),
  vp("tail", -0.21, 0.075, 0.065, 0.02, 0.03, 0.045),
  vp("tail", -0.21, 0.075, -0.065, 0.02, 0.03, 0.045),
  vp("wheel", 0.13, 0.03, 0.1, 0.075, 0.06, 0.03),
  vp("wheel", 0.13, 0.03, -0.1, 0.075, 0.06, 0.03),
  vp("wheel", -0.13, 0.03, 0.1, 0.075, 0.06, 0.03),
  vp("wheel", -0.13, 0.03, -0.1, 0.075, 0.06, 0.03),
];
/** A taxi is a car with a lit roof sign. */
export const TAXI_PARTS: VehiclePart[] = [...CAR_PARTS, vp("head", -0.02, 0.165, 0, 0.05, 0.03, 0.08)];
// Bus: 1.0 long x 0.24 wide x 0.26 tall with a dark window band along both sides and ends.
export const BUS_PARTS: VehiclePart[] = [
  vp("body", 0, 0.155, 0, 1.0, 0.21, 0.24),
  vp("dark", 0.02, 0.19, 0.12, 0.84, 0.08, 0.012), // window band, right side
  vp("dark", 0.02, 0.19, -0.12, 0.84, 0.08, 0.012), // window band, left side
  vp("dark", 0.5, 0.19, 0, 0.012, 0.08, 0.2), // windshield
  vp("dark", -0.5, 0.19, 0, 0.012, 0.08, 0.2), // rear window
  vp("head", 0.5, 0.09, 0.08, 0.016, 0.03, 0.04),
  vp("head", 0.5, 0.09, -0.08, 0.016, 0.03, 0.04),
  vp("tail", -0.5, 0.09, 0.08, 0.016, 0.03, 0.04),
  vp("tail", -0.5, 0.09, -0.08, 0.016, 0.03, 0.04),
  vp("wheel", 0.3, 0.04, 0.12, 0.08, 0.08, 0.03),
  vp("wheel", 0.3, 0.04, -0.12, 0.08, 0.08, 0.03),
  vp("wheel", -0.3, 0.04, 0.12, 0.08, 0.08, 0.03),
  vp("wheel", -0.3, 0.04, -0.12, 0.08, 0.08, 0.03),
];

const WHITE = new THREE.Color(1, 1, 1);

type VehicleSpec = { body: VehiclePart[]; glass: VehiclePart[]; wheels: VehiclePart[] };
const specOf = (parts: VehiclePart[]): VehicleSpec => ({
  body: parts.filter((q) => q.role === "body"),
  glass: parts.filter((q) => q.role !== "body" && q.role !== "wheel"),
  wheels: parts.filter((q) => q.role === "wheel"),
});
const CAR = specOf(CAR_PARTS);
const BUS = specOf(BUS_PARTS);

/** Colour of a non-body vehicle part. */
export function roleColor(role: Exclude<Role, "body">, palette: WorldPalette, out: THREE.Color): THREE.Color {
  switch (role) {
    case "glass":
      return out.set(palette.glass).lerp(WHITE, 0.45);
    case "dark":
      return out.set(palette.glass).multiplyScalar(0.45);
    case "head":
      return out.set(palette.headlight);
    case "tail":
      return out.set(palette.taillight);
    case "wheel":
      return out.set(palette.wheel);
  }
}

// Roblox-style figure, local frame like a vehicle (+x forward, +z right): 0.2 tall = legs 0.075, torso 0.075, head 0.05.
// Each limb hangs from a pivot (hip or shoulder) and swings about the side axis by `swing * k`.
type Limb = { px: number; py: number; pz: number; cy: number; sx: number; sy: number; sz: number; k: number };
export const FIGURE_HEIGHT = 0.2;
export const FIGURE_PARTS = 6;
const FIGURE: Limb[] = [
  { px: 0, py: 0.175, pz: 0, cy: 0, sx: 0.05, sy: 0.05, sz: 0.05, k: 0 }, // head
  { px: 0, py: 0.1125, pz: 0, cy: 0, sx: 0.04, sy: 0.075, sz: 0.07, k: 0 }, // torso
  { px: 0, py: 0.145, pz: -0.0475, cy: -0.035, sx: 0.03, sy: 0.07, sz: 0.025, k: -0.9 }, // left arm
  { px: 0, py: 0.145, pz: 0.0475, cy: -0.035, sx: 0.03, sy: 0.07, sz: 0.025, k: 0.9 }, // right arm
  { px: 0, py: 0.075, pz: -0.0175, cy: -0.0375, sx: 0.034, sy: 0.075, sz: 0.034, k: 1 }, // left leg
  { px: 0, py: 0.075, pz: 0.0175, cy: -0.0375, sx: 0.034, sy: 0.075, sz: 0.034, k: -1 }, // right leg
];

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const scratch = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), qz: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3() };

/** Writes the six boxes of one figure into `mesh` at instances base..base+5. `yaw` is the heading rotation about y; `swing` (radians) swings the legs, the arms the other way. */
export function poseFigure(mesh: THREE.InstancedMesh, base: number, x: number, y: number, z: number, yaw: THREE.Quaternion, swing: number, scale = 1): void {
  const { m, q, qz, p, s } = scratch;
  for (let k = 0; k < FIGURE_PARTS; k++) {
    const f = FIGURE[k];
    const a = swing * f.k;
    p.set(f.px - f.cy * Math.sin(a), f.py + f.cy * Math.cos(a), f.pz).multiplyScalar(scale).applyQuaternion(yaw);
    p.x += x;
    p.y += y;
    p.z += z;
    q.copy(yaw);
    if (a !== 0) q.multiply(qz.setFromAxisAngle(Z_AXIS, a));
    s.set(f.sx * scale, f.sy * scale, f.sz * scale);
    mesh.setMatrixAt(base + k, m.compose(p, q, s));
  }
}

/** Colours instances base..base+5: head skin, torso shirt, arms shirt or skin, legs pants. */
export function paintFigure(mesh: THREE.InstancedMesh, base: number, skin: string, shirt: string, pants: string, bareArms: boolean): void {
  const c = new THREE.Color();
  mesh.setColorAt(base, c.set(skin));
  mesh.setColorAt(base + 1, c.set(shirt));
  mesh.setColorAt(base + 2, c.set(bareArms ? skin : shirt));
  mesh.setColorAt(base + 3, c.set(bareArms ? skin : shirt));
  mesh.setColorAt(base + 4, c.set(pants));
  mesh.setColorAt(base + 5, c.set(pants));
}

const mix = (a: number, b: number): number => (Math.imul(a + 1, 2654435761) ^ Math.imul(b + 7, 40503)) >>> 0;

function resolvePalette(p: LifePalette | LegacyLifePalette): WorldPalette {
  if ("cars" in p) return p;
  return { ...FALLBACK_PALETTE, cars: p.car, people: p.person, shirts: p.person, steam: p.steam, bird: p.bird };
}

function pick(list: string[], i: number, fallback: string): string {
  return list.length > 0 ? (list[i % list.length] ?? fallback) : fallback;
}

export function makeMesh(name: string, count: number, color: string, opts?: { transparent?: boolean; opacity?: number }): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: opts?.transparent ?? false,
      opacity: opts?.opacity ?? 1,
    }),
    Math.max(count, 1),
  );
  mesh.name = name;
  mesh.count = count;
  mesh.frustumCulled = false;
  const m = new THREE.Matrix4();
  const c = new THREE.Color(color);
  for (let i = 0; i < count; i++) {
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

export function disposeMesh(mesh: THREE.Mesh | null) {
  if (!mesh) return;
  mesh.removeFromParent();
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
}

type CarAgent = Extract<Agent, { kind: "car" }>;
type BusAgent = Extract<Agent, { kind: "bus" }>;

type VehicleSet = {
  name: "cars" | "buses";
  spec: VehicleSpec;
  agents: (CarAgent | BusAgent)[];
  body: THREE.InstancedMesh | null;
  glass: THREE.InstancedMesh | null;
  wheels: THREE.InstancedMesh | null;
};

export function createLife({ scene, streets, spots, seed, density, palette: given }: CreateLifeOptions): LifeHandle {
  const palette = resolvePalette(given);
  let agents: Agent[] = planAgents(streets, spots, seed, density);
  let disposed = false;

  const mat = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const out = { x: 0, y: 0, z: 0 };

  const yAxis = new THREE.Vector3(0, 1, 0);
  const yaw = new THREE.Quaternion();
  const setInstance = (
    mesh: THREE.InstancedMesh,
    i: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ) => {
    pos.set(x, y, z);
    scl.set(sx, sy, sz);
    mat.compose(pos, quat, scl);
    mesh.setMatrixAt(i, mat);
  };

  // `yaw` must already hold the heading rotation: vehicle-local +x maps to (hx, hz), local +z to (-hz, hx).
  const placePart = (mesh: THREE.InstancedMesh, i: number, cx: number, cz: number, hx: number, hz: number, p: Part) => {
    pos.set(cx + p.ox * hx - p.oz * hz, VEHICLE_Y + p.oy, cz + p.ox * hz + p.oz * hx);
    scl.set(p.sx, p.sy, p.sz);
    mat.compose(pos, yaw, scl);
    mesh.setMatrixAt(i, mat);
  };

  const carSet: VehicleSet = { name: "cars", spec: CAR, agents: [], body: null, glass: null, wheels: null };
  const busSet: VehicleSet = { name: "buses", spec: BUS, agents: [], body: null, glass: null, wheels: null };
  const sets = [carSet, busSet];
  let peds: Extract<Agent, { kind: "ped" }>[] = [];
  let steams: Extract<Agent, { kind: "steam" }>[] = [];
  let birds: Extract<Agent, { kind: "bird" }>[] = [];
  let lights: Extract<Agent, { kind: "light" }>[] = [];
  let lightBucket: number[] = [];

  let pedMesh: THREE.InstancedMesh | null = null;
  let steamMesh: THREE.InstancedMesh | null = null;
  let birdMesh: THREE.InstancedMesh | null = null;
  let lightMesh: THREE.InstancedMesh | null = null;

  const split = () => {
    carSet.agents = [];
    busSet.agents = [];
    peds = [];
    steams = [];
    birds = [];
    lights = [];
    for (const a of agents) {
      if (a.kind === "car") carSet.agents.push(a);
      else if (a.kind === "bus") busSet.agents.push(a);
      else if (a.kind === "ped") peds.push(a);
      else if (a.kind === "steam") steams.push(a);
      else if (a.kind === "bird") birds.push(a);
      else lights.push(a);
    }
  };

  const paintVehicles = (set: VehicleSet) => {
    if (!set.body || !set.glass || !set.wheels) return;
    const { glass, wheels } = set.spec;
    set.agents.forEach((_a, i) => {
      set.body!.setColorAt(i, col.set(set.name === "cars" ? pick(palette.cars, i, FALLBACK_PALETTE.cars[0]) : palette.bus));
      glass.forEach((g, k) => set.glass!.setColorAt(i * glass.length + k, roleColor(g.role as Exclude<Role, "body">, palette, col)));
      for (let k = 0; k < wheels.length; k++) set.wheels!.setColorAt(i * wheels.length + k, col.set(palette.wheel));
    });
    for (const m of [set.body, set.glass, set.wheels]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };

  const paintStatic = () => {
    paintVehicles(carSet);
    paintVehicles(busSet);
    if (pedMesh) {
      peds.forEach((_p, i) => {
        const skin = pick(palette.skin, mix(i, 1), FALLBACK_PALETTE.skin[0]);
        const shirt = pick(palette.shirts, mix(i, 2), FALLBACK_PALETTE.shirts[0]);
        const pants = pick(palette.pants, mix(i, 3), FALLBACK_PALETTE.pants[0]);
        paintFigure(pedMesh!, i * FIGURE_PARTS, skin, shirt, pants, mix(i, 4) % 3 === 0);
      });
      if (pedMesh.instanceColor) pedMesh.instanceColor.needsUpdate = true;
    }
    if (steamMesh) {
      for (let i = 0; i < steamMesh.count; i++) {
        col.set(palette.steam);
        steamMesh.setColorAt(i, col);
      }
      if (steamMesh.instanceColor) steamMesh.instanceColor.needsUpdate = true;
    }
    if (birdMesh) {
      for (let i = 0; i < birdMesh.count; i++) {
        col.set(palette.bird);
        birdMesh.setColorAt(i, col);
      }
      if (birdMesh.instanceColor) birdMesh.instanceColor.needsUpdate = true;
    }
  };

  const buildKindMeshes = () => {
    split();
    for (const set of sets) {
      for (const m of [set.body, set.glass, set.wheels]) disposeMesh(m);
      set.body = set.glass = set.wheels = null;
      const n = set.agents.length;
      if (n === 0) continue;
      set.body = makeMesh(`${set.name}:body`, n * set.spec.body.length, "#ffffff");
      set.glass = makeMesh(`${set.name}:glass`, n * set.spec.glass.length, "#ffffff");
      set.wheels = makeMesh(`${set.name}:wheels`, n * set.spec.wheels.length, "#ffffff");
      scene.add(set.body, set.glass, set.wheels);
    }
    disposeMesh(pedMesh);
    pedMesh = null;
    if (peds.length > 0) {
      pedMesh = makeMesh("people:figure", peds.length * FIGURE_PARTS, "#ffffff");
      scene.add(pedMesh);
    }
  };

  const buildEphemeralMeshes = () => {
    if (steamMesh) {
      scene.remove(steamMesh);
      steamMesh.geometry.dispose();
      (steamMesh.material as THREE.Material).dispose();
      steamMesh = null;
    }
    if (birdMesh) {
      scene.remove(birdMesh);
      birdMesh.geometry.dispose();
      (birdMesh.material as THREE.Material).dispose();
      birdMesh = null;
    }
    if (steams.length > 0) {
      steamMesh = makeMesh("steam", steams.length * STEAM_PUFFS, palette.steam, { transparent: true, opacity: 0.55 });
      scene.add(steamMesh);
    }
    if (birds.length > 0) {
      birdMesh = makeMesh("birds", birds.length, palette.bird);
      scene.add(birdMesh);
    }
  };

  const buildLightMesh = () => {
    if (lightMesh) {
      scene.remove(lightMesh);
      lightMesh.geometry.dispose();
      (lightMesh.material as THREE.Material).dispose();
      lightMesh = null;
    }
    lightBucket = lights.map(() => -1);
    if (lights.length > 0) {
      lightMesh = makeMesh("signals", lights.length, palette.signalRed);
      scene.add(lightMesh);
    }
  };

  const layoutVehicles = (set: VehicleSet) => {
    if (!set.body || !set.glass || !set.wheels) return;
    const { body, glass, wheels } = set.spec;
    set.agents.forEach((c, i) => {
      writePosition(c, out);
      const h = headingOf(c);
      yaw.setFromAxisAngle(yAxis, Math.atan2(-h.z, h.x));
      for (let k = 0; k < body.length; k++) placePart(set.body!, i * body.length + k, out.x, out.z, h.x, h.z, body[k]);
      for (let k = 0; k < glass.length; k++) placePart(set.glass!, i * glass.length + k, out.x, out.z, h.x, h.z, glass[k]);
      for (let k = 0; k < wheels.length; k++) placePart(set.wheels!, i * wheels.length + k, out.x, out.z, h.x, h.z, wheels[k]);
    });
    for (const m of [set.body, set.glass, set.wheels]) m.instanceMatrix.needsUpdate = true;
  };

  const layout = () => {
    layoutVehicles(carSet);
    layoutVehicles(busSet);
    if (pedMesh) {
      peds.forEach((p, i) => {
        writePosition(p, out);
        const h = headingOf(p);
        yaw.setFromAxisAngle(yAxis, Math.atan2(-h.z, h.x));
        poseFigure(pedMesh!, i * FIGURE_PARTS, out.x, WALK_Y, out.z, yaw, gaitSwing(p));
      });
      pedMesh.instanceMatrix.needsUpdate = true;
    }
    if (steamMesh) {
      steams.forEach((e, i) => {
        for (let k = 0; k < STEAM_PUFFS; k++) {
          const f = (e.phase + k / STEAM_PUFFS) % 1;
          const q = Math.floor(f * 3) / 3;
          const size = 0.42 - q * 0.12;
          setInstance(
            steamMesh!,
            i * STEAM_PUFFS + k,
            e.x + (k - 1) * 0.18,
            e.y + 0.4 + q * STEAM_RISE,
            e.z + (1 - k) * 0.12,
            size,
            size,
            size,
          );
        }
      });
      steamMesh.instanceMatrix.needsUpdate = true;
    }
    if (birdMesh) {
      birds.forEach((b, i) => {
        writePosition(b, out);
        const hop = Math.floor(Math.abs(Math.sin(b.t * 2)) * 3) / 3;
        setInstance(birdMesh!, i, out.x, b.height + hop * 0.6, out.z, BIRD.x, BIRD.y, BIRD.z);
      });
      birdMesh.instanceMatrix.needsUpdate = true;
    }
    if (lightMesh) {
      let colorsDirty = false;
      lights.forEach((l, i) => {
        writePosition(l, out);
        setInstance(lightMesh!, i, out.x, SIGNAL_H / 2 + VEHICLE_Y, out.z, SIGNAL_W, SIGNAL_H, SIGNAL_W);
        const bucket = l.phase < l.period / 2 ? 0 : 1;
        if (lightBucket[i] !== bucket) {
          lightBucket[i] = bucket;
          col.set(bucket === 0 ? palette.signalRed : palette.signalGreen);
          lightMesh!.setColorAt(i, col);
          colorsDirty = true;
        }
      });
      lightMesh.instanceMatrix.needsUpdate = true;
      if (colorsDirty && lightMesh.instanceColor) lightMesh.instanceColor.needsUpdate = true;
    }
  };

  buildKindMeshes();
  buildEphemeralMeshes();
  buildLightMesh();
  paintStatic();
  layout();

  return {
    update(dtSec: number) {
      if (disposed) return;
      const dt = Number.isFinite(dtSec) ? Math.min(Math.max(dtSec, 0), 0.1) : 0;
      if (dt > 0) {
        for (let i = 0; i < agents.length; i++) agents[i] = stepAgent(agents[i], dt);
        split();
      }
      layout();
    },
    setSpots(next: Spot[]) {
      if (disposed) return;
      const keep = agents.filter((a) => a.kind !== "steam" && a.kind !== "bird");
      agents = [...keep, ...planAgents(streets, next, seed, density).filter((a) => a.kind === "steam" || a.kind === "bird")];
      split();
      buildEphemeralMeshes();
      paintStatic();
      layout();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of [carSet.body, carSet.glass, carSet.wheels, busSet.body, busSet.glass, busSet.wheels, pedMesh, steamMesh, birdMesh, lightMesh]) disposeMesh(mesh);
      carSet.body = carSet.glass = carSet.wheels = busSet.body = busSet.glass = busSet.wheels = pedMesh = steamMesh = birdMesh = lightMesh = null;
      agents = [];
    },
  };
}
