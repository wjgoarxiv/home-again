import * as THREE from "three";
import { planAgents, stepAgent, writePosition, type Agent, type Spot, type Street } from "../../lib/life";

export type LifePalette = {
  car: string[];
  person: string[];
  steam: string;
  bird: string;
};

export type CreateLifeOptions = {
  scene: THREE.Scene;
  streets: Street[];
  spots: Spot[];
  seed: number;
  density: number;
  palette: LifePalette;
};

export type LifeHandle = {
  update(dtSec: number): void;
  setSpots(spots: Spot[]): void;
  dispose(): void;
};

const STEAM_PUFFS = 3;
const STEAM_RISE = 2.2;
const RED = "#c8370c";
const GREEN = "#2e7d46";

function pick(list: string[], i: number, fallback: string): string {
  return list.length > 0 ? (list[i % list.length] ?? fallback) : fallback;
}

function makeMesh(count: number, color: string, opts?: { transparent?: boolean; opacity?: number }): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: opts?.transparent ?? false,
      opacity: opts?.opacity ?? 1,
    }),
    Math.max(count, 1),
  );
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

export function createLife({ scene, streets, spots, seed, density, palette }: CreateLifeOptions): LifeHandle {
  let agents: Agent[] = planAgents(streets, spots, seed, density);
  let disposed = false;

  const mat = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const out = { x: 0, y: 0, z: 0 };

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

  let cars: Extract<Agent, { kind: "car" }>[] = [];
  let peds: Extract<Agent, { kind: "ped" }>[] = [];
  let steams: Extract<Agent, { kind: "steam" }>[] = [];
  let birds: Extract<Agent, { kind: "bird" }>[] = [];
  let lights: Extract<Agent, { kind: "light" }>[] = [];
  let lightBucket: number[] = [];

  let carMesh: THREE.InstancedMesh | null = null;
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
    if (carMesh) {
      cars.forEach((_c, i) => {
        const body = pick(palette.car, i, "#5a5e5a");
        const roof = pick(palette.car, i + 1, "#2f322f");
        col.set(body);
        carMesh!.setColorAt(i * 2, col);
        col.set(roof === body ? "#2f322f" : roof);
        carMesh!.setColorAt(i * 2 + 1, col);
      });
      if (carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true;
    }
    if (pedMesh) {
      peds.forEach((p, i) => {
        col.set(pick(palette.person, i, "#6b6e6a"));
        pedMesh!.setColorAt(i, col);
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
    if (carMesh) {
      scene.remove(carMesh);
      carMesh.geometry.dispose();
      (carMesh.material as THREE.Material).dispose();
      carMesh = null;
    }
    if (pedMesh) {
      scene.remove(pedMesh);
      pedMesh.geometry.dispose();
      (pedMesh.material as THREE.Material).dispose();
      pedMesh = null;
    }
    if (cars.length > 0) {
      carMesh = makeMesh(cars.length * 2, "#ffffff");
      scene.add(carMesh);
    }
    if (peds.length > 0) {
      pedMesh = makeMesh(peds.length, "#ffffff");
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
      steamMesh = makeMesh(steams.length * STEAM_PUFFS, palette.steam, { transparent: true, opacity: 0.55 });
      scene.add(steamMesh);
    }
    if (birds.length > 0) {
      birdMesh = makeMesh(birds.length, palette.bird);
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
      lightMesh = makeMesh(lights.length, RED);
      scene.add(lightMesh);
    }
  };

  const layout = () => {
    if (carMesh) {
      cars.forEach((c, i) => {
        writePosition(c, out);
        const alongX = c.axis === "x";
        const bl = 1.7;
        const bw = 0.8;
        setInstance(carMesh!, i * 2, out.x, 0.45, out.z, alongX ? bl : bw, 0.5, alongX ? bw : bl);
        setInstance(carMesh!, i * 2 + 1, out.x, 0.87, out.z, alongX ? 0.8 : 0.7, 0.35, alongX ? 0.7 : 0.8);
      });
      carMesh.instanceMatrix.needsUpdate = true;
    }
    if (pedMesh) {
      peds.forEach((p, i) => {
        writePosition(p, out);
        setInstance(pedMesh!, i, out.x, 0.5, out.z, 0.35, 1.0, 0.35);
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
          col.set(bucket === 0 ? RED : GREEN);
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
      for (const mesh of [carMesh, pedMesh, steamMesh, birdMesh, lightMesh]) {
        if (!mesh) continue;
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      carMesh = pedMesh = steamMesh = birdMesh = lightMesh = null;
      agents = [];
    },
  };
}
