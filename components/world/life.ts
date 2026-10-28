import * as THREE from "three";
import { headingOf, planAgents, stepAgent, writePosition, type Agent, type Spot, type Street } from "../../lib/life";
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

type Part = { ox: number; oy: number; oz: number; sx: number; sy: number; sz: number };
const part = (ox: number, oy: number, oz: number, sx: number, sy: number, sz: number): Part => ({ ox, oy, oz, sx, sy, sz });

// Car-local frame: +x is the direction of travel, +z the right-hand side, y up. Body is 2.0 x 0.6 x 0.95.
const CAR_BODY = part(0, 0.48, 0, 2.0, 0.6, 0.95);
const CAR_GLASS: Part[] = [
  part(-0.1, 0.98, 0, 1.1, 0.4, 0.85), // cabin
  part(0.47, 0.98, 0, 0.08, 0.3, 0.8), // windshield band
  part(-0.67, 0.98, 0, 0.08, 0.3, 0.8), // rear-window band
  part(1.02, 0.52, 0.3, 0.08, 0.16, 0.2), // headlights
  part(1.02, 0.52, -0.3, 0.08, 0.16, 0.2),
  part(-1.02, 0.52, 0.3, 0.08, 0.16, 0.2), // taillights
  part(-1.02, 0.52, -0.3, 0.08, 0.16, 0.2),
];
const CAR_WHEELS: Part[] = [
  part(0.62, 0.21, 0.5, 0.42, 0.42, 0.18),
  part(0.62, 0.21, -0.5, 0.42, 0.42, 0.18),
  part(-0.62, 0.21, 0.5, 0.42, 0.42, 0.18),
  part(-0.62, 0.21, -0.5, 0.42, 0.42, 0.18),
];
// Pedestrian: torso 0.35 wide, head on top, about 1.1 tall in all.
const PED_PARTS: Part[] = [part(0, 0.4, 0, 0.24, 0.8, 0.35), part(0, 0.95, 0, 0.28, 0.3, 0.28)];
const SKIN_LIFT = [0, 0.25, 0.45];
const WHITE = new THREE.Color(1, 1, 1);

function resolvePalette(p: LifePalette | LegacyLifePalette): WorldPalette {
  if ("cars" in p) return p;
  return { ...FALLBACK_PALETTE, cars: p.car, people: p.person, steam: p.steam, bird: p.bird };
}

function pick(list: string[], i: number, fallback: string): string {
  return list.length > 0 ? (list[i % list.length] ?? fallback) : fallback;
}

function makeMesh(name: string, count: number, color: string, opts?: { transparent?: boolean; opacity?: number }): THREE.InstancedMesh {
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

function disposeMesh(mesh: THREE.InstancedMesh | null) {
  if (!mesh) return;
  mesh.removeFromParent();
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
}

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

  // `yaw` must already hold the heading rotation: car-local +x maps to (hx, hz), local +z to (-hz, hx).
  const placePart = (mesh: THREE.InstancedMesh, i: number, cx: number, cz: number, hx: number, hz: number, p: Part) => {
    pos.set(cx + p.ox * hx - p.oz * hz, p.oy, cz + p.ox * hz + p.oz * hx);
    scl.set(p.sx, p.sy, p.sz);
    mat.compose(pos, yaw, scl);
    mesh.setMatrixAt(i, mat);
  };

  let cars: Extract<Agent, { kind: "car" }>[] = [];
  let peds: Extract<Agent, { kind: "ped" }>[] = [];
  let steams: Extract<Agent, { kind: "steam" }>[] = [];
  let birds: Extract<Agent, { kind: "bird" }>[] = [];
  let lights: Extract<Agent, { kind: "light" }>[] = [];
  let lightBucket: number[] = [];

  let carBody: THREE.InstancedMesh | null = null;
  let carGlass: THREE.InstancedMesh | null = null;
  let carWheels: THREE.InstancedMesh | null = null;
  let pedMesh: THREE.InstancedMesh | null = null;
  let steamMesh: THREE.InstancedMesh | null = null;
  let birdMesh: THREE.InstancedMesh | null = null;
  let lightMesh: THREE.InstancedMesh | null = null;

  const split = () => {
    cars = [];
    peds = [];
    steams = [];
    birds = [];
    lights = [];
    for (const a of agents) {
      if (a.kind === "car") cars.push(a);
      else if (a.kind === "ped") peds.push(a);
      else if (a.kind === "steam") steams.push(a);
      else if (a.kind === "bird") birds.push(a);
      else lights.push(a);
    }
  };

  const paintStatic = () => {
    if (carBody && carGlass && carWheels) {
      const glassLight = new THREE.Color(palette.glass).lerp(WHITE, 0.45);
      const glassDark = new THREE.Color(palette.glass).multiplyScalar(0.45);
      const glassColors = [glassLight, glassDark, glassDark];
      cars.forEach((_c, i) => {
        carBody!.setColorAt(i, col.set(pick(palette.cars, i, FALLBACK_PALETTE.cars[0])));
        for (let k = 0; k < CAR_GLASS.length; k++) {
          const c = k < 3 ? glassColors[k] : k < 5 ? col.set(palette.headlight) : col.set(palette.taillight);
          carGlass!.setColorAt(i * CAR_GLASS.length + k, c);
        }
        for (let k = 0; k < CAR_WHEELS.length; k++) carWheels!.setColorAt(i * CAR_WHEELS.length + k, col.set(palette.wheel));
      });
      for (const m of [carBody, carGlass, carWheels]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if (pedMesh) {
      peds.forEach((_p, i) => {
        pedMesh!.setColorAt(i * 2, col.set(pick(palette.people, i, FALLBACK_PALETTE.people[0])));
        pedMesh!.setColorAt(i * 2 + 1, col.set(palette.trunk).lerp(WHITE, SKIN_LIFT[i % SKIN_LIFT.length]));
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
    for (const m of [carBody, carGlass, carWheels, pedMesh]) disposeMesh(m);
    carBody = carGlass = carWheels = pedMesh = null;
    if (cars.length > 0) {
      carBody = makeMesh("cars:body", cars.length, "#ffffff");
      carGlass = makeMesh("cars:glass", cars.length * CAR_GLASS.length, "#ffffff");
      carWheels = makeMesh("cars:wheels", cars.length * CAR_WHEELS.length, "#ffffff");
      scene.add(carBody, carGlass, carWheels);
    }
    if (peds.length > 0) {
      pedMesh = makeMesh("people:figure", peds.length * PED_PARTS.length, "#ffffff");
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

  const layout = () => {
    if (carBody && carGlass && carWheels) {
      cars.forEach((c, i) => {
        writePosition(c, out);
        const h = headingOf(c);
        yaw.setFromAxisAngle(yAxis, Math.atan2(-h.z, h.x));
        placePart(carBody!, i, out.x, out.z, h.x, h.z, CAR_BODY);
        for (let k = 0; k < CAR_GLASS.length; k++) placePart(carGlass!, i * CAR_GLASS.length + k, out.x, out.z, h.x, h.z, CAR_GLASS[k]);
        for (let k = 0; k < CAR_WHEELS.length; k++) placePart(carWheels!, i * CAR_WHEELS.length + k, out.x, out.z, h.x, h.z, CAR_WHEELS[k]);
      });
      for (const m of [carBody, carGlass, carWheels]) m.instanceMatrix.needsUpdate = true;
    }
    if (pedMesh) {
      peds.forEach((p, i) => {
        writePosition(p, out);
        const h = headingOf(p);
        yaw.setFromAxisAngle(yAxis, Math.atan2(-h.z, h.x));
        for (let k = 0; k < PED_PARTS.length; k++) placePart(pedMesh!, i * PED_PARTS.length + k, out.x, out.z, h.x, h.z, PED_PARTS[k]);
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
        setInstance(birdMesh!, i, out.x, b.height + hop * 0.6, out.z, 0.3, 0.2, 0.35);
      });
      birdMesh.instanceMatrix.needsUpdate = true;
    }
    if (lightMesh) {
      let colorsDirty = false;
      lights.forEach((l, i) => {
        writePosition(l, out);
        setInstance(lightMesh!, i, out.x, 0.6, out.z, 0.4, 1.2, 0.4);
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
      for (const mesh of [carBody, carGlass, carWheels, pedMesh, steamMesh, birdMesh, lightMesh]) disposeMesh(mesh);
      carBody = carGlass = carWheels = pedMesh = steamMesh = birdMesh = lightMesh = null;
      agents = [];
    },
  };
}
