export type Street = {
  x: number;
  z: number;
  dir: "x" | "z";
  length: number;
  lanes: 1 | 2;
};

export type Spot = { id: string; x: number; z: number; height: number };

export type CarAgent = {
  kind: "car";
  id: string;
  street: number;
  s: number;
  dir: 1 | -1;
  speed: number;
  lane: number;
  len: number;
  ox: number;
  oz: number;
  axis: "x" | "z";
  off: number;
};

export type PedAgent = {
  kind: "ped";
  id: string;
  street: number;
  s: number;
  dir: 1 | -1;
  speed: number;
  side: 1 | -1;
  len: number;
  ox: number;
  oz: number;
  axis: "x" | "z";
  off: number;
  pause: number;
  nextPause: number;
};

export type SteamAgent = {
  kind: "steam";
  id: string;
  spot: string;
  x: number;
  z: number;
  y: number;
  phase: number;
  speed: number;
};

export type BirdAgent = {
  kind: "bird";
  id: string;
  cx: number;
  cz: number;
  t: number;
  radius: number;
  speed: number;
  height: number;
};

export type LightAgent = {
  kind: "light";
  id: string;
  x: number;
  z: number;
  phase: number;
  period: number;
};

export type Agent = CarAgent | PedAgent | SteamAgent | BirdAgent | LightAgent;

export const MAX_CARS = 40;
export const MAX_PEDS = 60;
export const MAX_BIRDS = 8;
const MAX_LIGHTS = 12;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampDensity(d: number): number {
  if (!Number.isFinite(d)) return 0;
  return Math.min(1, Math.max(0, d));
}

export function planAgents(streets: Street[], spots: Spot[], seed: number, density: number): Agent[] {
  const d = clampDensity(density);
  const rng = mulberry32(seed);
  const agents: Agent[] = [];
  const usable = streets
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => Number.isFinite(s.length) && s.length > 0 && (s.dir === "x" || s.dir === "z"));

  const carTarget = usable.length === 0 ? 0 : Math.round(d * MAX_CARS);
  for (let i = 0; i < carTarget; i++) {
    const { s: st, i: si } = usable[i % usable.length];
    const twoLane = st.lanes === 2;
    const dir: 1 | -1 = !twoLane ? 1 : i % 2 === 0 ? 1 : -1;
    const lane = !twoLane ? 0 : dir === 1 ? 0 : 1;
    agents.push({
      kind: "car",
      id: `car-${i}`,
      street: si,
      s: rng() * st.length,
      dir,
      speed: 2 + rng() * 2,
      lane,
      len: st.length,
      ox: st.x,
      oz: st.z,
      axis: st.dir,
      off: !twoLane ? 0 : dir === 1 ? 0.35 : -0.35,
    });
  }

  const pedTarget = usable.length === 0 ? 0 : Math.round(d * MAX_PEDS);
  for (let i = 0; i < pedTarget; i++) {
    const { s: st, i: si } = usable[(i + (carTarget % Math.max(usable.length, 1))) % usable.length];
    const side: 1 | -1 = rng() < 0.5 ? 1 : -1;
    agents.push({
      kind: "ped",
      id: `ped-${i}`,
      street: si,
      s: rng() * st.length,
      dir: rng() < 0.5 ? 1 : -1,
      speed: 0.3 + rng() * 0.3,
      side,
      len: st.length,
      ox: st.x,
      oz: st.z,
      axis: st.dir,
      off: side * 0.6,
      pause: 0,
      nextPause: 0,
    });
  }

  for (const spot of spots) {
    agents.push({
      kind: "steam",
      id: `steam-${spot.id}`,
      spot: spot.id,
      x: spot.x,
      z: spot.z,
      y: spot.height,
      phase: rng(),
      speed: 0.25 + rng() * 0.2,
    });
  }

  const birdTarget = spots.length === 0 ? 0 : Math.round(d * Math.min(MAX_BIRDS, spots.length * 2));
  for (let i = 0; i < birdTarget; i++) {
    const spot = spots[i % spots.length];
    agents.push({
      kind: "bird",
      id: `bird-${i}`,
      cx: spot.x + (rng() - 0.5) * 4,
      cz: spot.z + (rng() - 0.5) * 4,
      t: rng() * Math.PI * 2,
      radius: 1 + rng() * 2,
      speed: 1.5 + rng() * 1.5,
      height: spot.height + 1 + rng() * 2,
    });
  }

  const lightCount = Math.min(MAX_LIGHTS, usable.length);
  for (let i = 0; i < lightCount; i++) {
    const { s: st } = usable[i];
    agents.push({
      kind: "light",
      id: `light-${i}`,
      x: st.dir === "x" ? st.x + st.length : st.x,
      z: st.dir === "x" ? st.z : st.z + st.length,
      phase: rng() * 8,
      period: 8,
    });
  }

  // Pedestrian pause fields assigned after placement so ordering stays stable.
  for (const a of agents) {
    if (a.kind === "ped") {
      a.pause = 0;
      a.nextPause = 4 + rng() * 8;
    }
  }
  return agents;
}

function stepCar(a: CarAgent, dt: number): CarAgent {
  let s = a.s + a.dir * a.speed * dt;
  let dir = a.dir;
  if (a.len <= 0) return { ...a, s: 0 };
  if (a.lane === 1) {
    let guard = 0;
    while ((s < 0 || s > a.len) && guard++ < 64) {
      if (s > a.len) {
        s = 2 * a.len - s;
        dir = dir === 1 ? -1 : 1;
      } else {
        s = -s;
        dir = dir === 1 ? -1 : 1;
      }
    }
  } else {
    s = ((s % a.len) + a.len) % a.len;
    if (s === a.len) s = 0;
  }
  return { ...a, s, dir };
}

function stepPed(a: PedAgent, dt: number): PedAgent {
  if (a.pause > 0) return { ...a, pause: Math.max(0, a.pause - dt) };
  let s = a.s + a.dir * a.speed * dt;
  let dir = a.dir;
  if (a.len <= 0) return { ...a, s: 0 };
  let guard = 0;
  while ((s < 0 || s > a.len) && guard++ < 64) {
    if (s > a.len) {
      s = 2 * a.len - s;
      dir = dir === 1 ? -1 : 1;
    } else {
      s = -s;
      dir = dir === 1 ? -1 : 1;
    }
  }
  const nextPause = a.nextPause - dt;
  if (nextPause <= 0) return { ...a, s, dir, pause: 1.5, nextPause: 6 };
  return { ...a, s, dir, nextPause };
}

export function stepAgent(agent: Agent, dtSec: number): Agent {
  if (!Number.isFinite(dtSec) || dtSec <= 0) return agent;
  const dt = Math.min(dtSec, 5);
  switch (agent.kind) {
    case "car":
      return stepCar(agent, dt);
    case "ped":
      return stepPed(agent, dt);
    case "steam":
      return { ...agent, phase: (agent.phase + dt * agent.speed) % 1 };
    case "bird":
      return { ...agent, t: agent.t + dt * agent.speed };
    case "light":
      return { ...agent, phase: (agent.phase + dt) % agent.period };
  }
}

export function writePosition(a: Agent, out: { x: number; y: number; z: number }): void {
  switch (a.kind) {
    case "car":
    case "ped":
      if (a.axis === "x") {
        out.x = a.ox + a.s;
        out.y = 0;
        out.z = a.oz + a.off;
      } else {
        out.x = a.ox + a.off;
        out.y = 0;
        out.z = a.oz + a.s;
      }
      return;
    case "steam":
      out.x = a.x;
      out.y = a.y;
      out.z = a.z;
      return;
    case "bird":
      out.x = a.cx + Math.cos(a.t) * a.radius;
      out.y = a.height + Math.abs(Math.sin(a.t * 2)) * 0.6;
      out.z = a.cz + Math.sin(a.t) * a.radius;
      return;
    case "light":
      out.x = a.x;
      out.y = 0;
      out.z = a.z;
      return;
  }
}

export function agentPosition(a: Agent): { x: number; y: number; z: number } {
  const out = { x: 0, y: 0, z: 0 };
  writePosition(a, out);
  return out;
}

/** Unit vector (x, z) a car or pedestrian is facing: along its street axis in the direction of travel. */
export function headingOf(a: CarAgent | PedAgent): { x: number; z: number } {
  return a.axis === "x" ? { x: a.dir, z: 0 } : { x: 0, z: a.dir };
}
