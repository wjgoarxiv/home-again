"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { clampZoom, compactLabel, fitAllScene, fitScene, followZoom, isoFit } from "../../lib/world";
import type { Scene, Tower } from "../../lib/world";
import { buildGraph, polylinesFromSnapshot, type P, type StreetGraph, type TravelMode } from "../../lib/route";
import { buildTown, planTown, seedFromString, streetPolylines, type TownCafe, type TownPalette } from "./town";
import { createLife, type LifeHandle } from "./life";
import { createTraveler, type TravelerHandle } from "./traveler";
import type { Street } from "../../lib/life";
import type { GeoSnapshot } from "../../lib/geomap";
import { worldPalette, type WorldPalette } from "./palette";
import { buildRealTown, tripFor, type CafeSpot, type RealTown } from "./realTown";
import type { TripInfo } from "./World";

export type VoxelWorldProps = {
  scene: Scene;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReady?: () => void;
  /** Real NYC footprints and streets for this area; null/undefined = procedural town. */
  geo?: GeoSnapshot | null;
  /** Tour focus: the camera steps to this tower. null/undefined = the finale tower (if any) or normal framing. */
  focusId?: string | null;
  /** Café id to send the user's character to; a change to a new id starts a trip, null cancels one under way. */
  travelTo?: string | null;
  travelMode?: TravelMode | "auto";
  onArrive?: (id: string) => void;
  onTrip?: (info: TripInfo | null) => void;
  /** px kept clear at the top for a floating bar (else the CSS var --stage-inset-top is read). */
  insetTop?: number;
};

type Palette = {
  accent: string;
  accent2: string;
  support: string;
  ink2: string;
  line: string;
  lineStrong: string;
};

type Label = { id: string; n: number; name: string; distanceM: number; left: number; top: number; hide: boolean };

const VOX = 1.8;
const VOX_H = 1;
const LOT_Y = 0.22;
/** The newcomer's home: where the character starts, a little house on the area centre. */
const HOME_CLEAR = 2.2;
const HOME_PAD = 3.2;
/** The character stands in front of the house door (+z face) and at each café's front corner, not inside the box. */
const HOME_STEP: P = { x: 0, z: 1.1 };
const CAFE_STEP = 1.15;
/** Towers rise in this many steps when new cards arrive. */
const RISE_STEPS = 4;
const RISE_MS = 110;
/** Trips closer than this count as already there. */
const ARRIVED_M = 3;
/** Camera height ratio at full tilt: (1, STEEP_Y, 1) looks down at ~74 degrees instead of the isometric ~35. */
const STEEP_Y = 5;
/** The follow camera pauses this long on the arrived character before easing back to the overview. */
const ARRIVE_HOLD_MS = 1000;
const EASE_BACK_STEPS = 4;
const EASE_BACK_MS = 100;
/** Exponential follow rates (per second) for the camera target and zoom while travelling. */
const FOLLOW_RATE = 5;
const FOLLOW_ZOOM_RATE = 2.5;

const EMPTY_GRAPH: StreetGraph = { nodes: [], adj: [] };

type ThreeState = {
  renderer: THREE.WebGLRenderer;
  camera: THREE.OrthographicCamera;
  root: THREE.Scene;
  content: THREE.Group | null;
  tops: Map<string, number>;
  bases: Map<string, number>;
  target: THREE.Vector3;
  reduced: boolean;
  stepTimers: number[];
  prevCounts: Map<string, number>;
  palette: Palette;
  world: WorldPalette;
  realTown: RealTown | null;
  proc: THREE.Group | null;
  lifeStreets: Street[] | null;
  pointers: Map<number, { x: number; y: number }>;
  pinchDist: number | null;
  /** Ortho half-width of the fitted overview (zoom 1), scene units. */
  fitHalf: number;
  /** How far the camera target may be panned from the origin. */
  panLimit: number;
  fitKey: string;
  lastFocus: string | null;
  applyFit: () => void;
  render: () => void;
  renderNow: () => void;
  setupLife: () => void;
  life: LifeHandle | null;
  lifeRaf: number;
  lastT: number;
  labelKey: string;
  visible: boolean;
  densityBucket: number;
  streets: Street[];
  insetTop: number;
  readInset: () => void;
  graph: StreetGraph | null;
  traveler: TravelerHandle | null;
  /** Where the character stands (home's doorstep until the first trip, then wherever the last trip ended). */
  pos: P;
  trip: TripInfo | null;
  /** The travelMode prop the trip under way was planned with. */
  tripMode: TravelMode | "auto";
  /** The camera follows the character (trip under way, and the hold before it eases back). */
  follow: boolean;
  followZ: number;
  /** 0 = isometric overview, 1 = steep street view used while following, so tall buildings don't hide the ride. */
  tilt: number;
  camTimers: number[];
  guard: number | null;
  travelKey: string | null;
  startTrip: (to: { id: string; x: number; z: number }) => void;
  cancelTrip: () => void;
};

function readPalette(): Palette {
  const css = (name: string, fallback: string) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    accent: css("--c-accent", "#c8370c"),
    accent2: css("--c-accent-2", "#1559b8"),
    support: css("--c-support", "#cfe6c7"),
    ink2: css("--c-ink-2", "#2f322f"),
    line: css("--c-line", "#c3c5bf"),
    lineStrong: css("--c-line-strong", "#3a3d3a"),
  };
}

/** The procedural town's fallback colours, all from the world palette. */
function townPalette(w: WorldPalette): TownPalette {
  return {
    base: w.ground,
    road: w.road,
    marking: w.marking,
    cross: w.crossing,
    side: w.sidewalk,
    grass: w.park,
    path: w.sidewalk,
    wallA: w.facades[0],
    wallB: w.facades[3 % w.facades.length],
    brick: w.facades[1 % w.facades.length],
    roof: w.roofs[0],
    detail: w.roofs[1 % w.roofs.length],
    store: w.awning[0],
    windowDark: w.glass,
    windowLitA: w.litWindow,
    windowLitB: w.awning[3 % w.awning.length],
    trunk: w.trunk,
    canopy: w.leaf[0],
    pole: w.roofs[2 % w.roofs.length],
    lampHead: w.litWindow,
    bench: w.trunk,
    signalA: w.signalRed,
    signalB: w.signalGreen,
    facades: w.facades,
    roofs: w.roofs,
    awning: w.awning,
  };
}

function roleColor(tower: Tower, palette: Palette): string {
  switch (tower.role) {
    case "drinks":
      return palette.accent;
    case "ambience":
      return palette.accent2;
    case "decor":
      return palette.support;
    case "menu":
      return palette.ink2;
    default:
      return palette.line;
  }
}

/** Visible voxel count and per-voxel colours for one tower. */
function towerVoxels(
  tower: Tower,
  palette: Palette,
): { count: number; colors: string[]; marker: boolean } {
  const marker = tower.status === "revisit";
  if (tower.status === "rejected") return { count: 1, colors: [palette.lineStrong], marker: false };
  const count =
    tower.status === "crowded" ? Math.max(1, Math.floor(tower.height / 2)) : tower.height;
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    if (tower.status === "loved" || tower.status === "revisit") colors.push(palette.accent);
    else if (tower.status === "crowded") colors.push(palette.lineStrong);
    else if (tower.status === "seen") colors.push(palette.ink2);
    else colors.push(i === count - 1 ? roleColor(tower, palette) : palette.ink2);
  }
  if (tower.status === "seen") {
    const dim = new THREE.Color(palette.ink2).multiplyScalar(0.45).getStyle();
    return { count, colors: colors.map(() => dim), marker: false };
  }
  return { count, colors, marker };
}

function boxMesh(count: number, color: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    Math.max(count, 1),
  );
  mesh.count = count;
  const c = new THREE.Color(color);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function place(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string) {
  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion(),
    new THREE.Vector3(sx, sy, sz),
  );
  mesh.setMatrixAt(i, m);
  mesh.setColorAt(i, new THREE.Color(color));
}

/** A little house of three boxes (walls, roof slab, door) on the area centre, in the home colour. */
function houseMesh(world: WorldPalette): THREE.InstancedMesh {
  const roof = new THREE.Color(world.home).multiplyScalar(0.6).getStyle();
  const mesh = boxMesh(3, world.home);
  mesh.userData.layer = "house";
  place(mesh, 0, 0, LOT_Y + 0.55, 0, 1.5, 1.1, 1.5, world.home);
  place(mesh, 1, 0, LOT_Y + 1.25, 0, 1.9, 0.3, 1.9, roof);
  place(mesh, 2, 0, LOT_Y + 0.3, 0.76, 0.4, 0.6, 0.06, world.litWindow);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

/**
 * Buildings are taller than the street is wide, so from the isometric camera they hide the character most of the
 * time. Every mesh under `rig` gets a see-through twin that draws only where something is in front of the original
 * (a flat translucent silhouette), kept in step with the original each frame.
 */
function makeGhosts(rig: THREE.Group, color: string): { sync: () => void } {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.5,
    depthFunc: THREE.GreaterDepth,
    depthWrite: false,
  });
  const pairs: { src: THREE.Mesh; ghost: THREE.Mesh }[] = [];
  for (const src of [...rig.children] as THREE.Mesh[]) {
    if (!src.isMesh) continue;
    const instanced = src as THREE.InstancedMesh;
    let ghost: THREE.Mesh;
    if (instanced.isInstancedMesh) {
      const g = new THREE.InstancedMesh(src.geometry, material, instanced.instanceMatrix.count);
      g.instanceMatrix = instanced.instanceMatrix;
      ghost = g;
    } else {
      ghost = new THREE.Mesh(src.geometry, material);
    }
    ghost.frustumCulled = false;
    ghost.renderOrder = 5;
    rig.add(ghost);
    pairs.push({ src, ghost });
  }
  return {
    sync: () => {
      for (const { src, ghost } of pairs) {
        ghost.visible = src.visible;
        if ((src as THREE.InstancedMesh).isInstancedMesh) (ghost as THREE.InstancedMesh).count = (src as THREE.InstancedMesh).count;
        else {
          ghost.position.copy(src.position);
          ghost.quaternion.copy(src.quaternion);
          ghost.scale.copy(src.scale);
        }
      }
    },
  };
}

export default function VoxelWorld({
  scene,
  selectedId,
  onSelect,
  onReady,
  geo = null,
  focusId: focusProp = null,
  travelTo = null,
  travelMode = "auto",
  onArrive,
  onTrip,
  insetTop,
}: VoxelWorldProps) {
  const focusId = focusProp ?? scene.focusId;
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const onArriveRef = useRef(onArrive);
  onArriveRef.current = onArrive;
  const onTripRef = useRef(onTrip);
  onTripRef.current = onTrip;
  const modeRef = useRef(travelMode);
  modeRef.current = travelMode;
  const [labels, setLabels] = useState<Label[]>([]);
  const [homeLabel, setHomeLabel] = useState<{
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
    transform?: string;
    docked?: boolean;
  }>({ left: 0, top: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const threeRef = useRef<ThreeState | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const palette = readPalette();
    const world = worldPalette();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setClearColor(new THREE.Color(world.sky));
    container.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
      touchAction: "none",
      cursor: "grab",
    });

    const root = new THREE.Scene();
    root.add(new THREE.AmbientLight(0xffffff, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(60, 120, 20);
    root.add(key);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600);
    const target = new THREE.Vector3(0, 0, 0);
    const rig = new THREE.Group();
    root.add(rig);
    const traveler = createTraveler({ scene: rig, palette: world });
    traveler.place(HOME_STEP.x, HOME_STEP.z);
    const ghosts = makeGhosts(rig, world.avatar);
    const st: ThreeState = {
      renderer,
      camera,
      root,
      content: null,
      tops: new Map(),
      bases: new Map(),
      target,
      reduced,
      stepTimers: [],
      prevCounts: new Map(),
      palette,
      world,
      realTown: null,
      proc: null,
      lifeStreets: null,
      pointers: new Map(),
      pinchDist: null,
      fitHalf: 46,
      panLimit: 46,
      fitKey: "",
      lastFocus: null,
      applyFit: () => {},
      render: () => {},
      renderNow: () => {},
      setupLife: () => {},
      life: null,
      lifeRaf: 0,
      lastT: 0,
      labelKey: "",
      visible: true,
      densityBucket: -1,
      streets: [],
      insetTop: 0,
      readInset: () => {},
      graph: null,
      traveler,
      pos: { ...HOME_STEP },
      trip: null,
      tripMode: "auto",
      follow: false,
      followZ: 4.5,
      tilt: 0,
      camTimers: [],
      guard: null,
      travelKey: null,
      startTrip: () => {},
      cancelTrip: () => {},
    };
    threeRef.current = st;

    const readInset = () => {
      st.insetTop = Math.max(0, parseFloat(getComputedStyle(container).getPropertyValue("--stage-inset-top")) || 0);
    };
    st.readInset = readInset;
    readInset();

    const fit = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w < 640 ? 1.5 : 2));
      renderer.setSize(w, h, false);
      const aspect = Math.max(w / h, 0.2);
      st.fitHalf = isoFit(sceneRef.current, aspect);
      const halfH = st.fitHalf / aspect;
      camera.left = -st.fitHalf;
      camera.right = st.fitHalf;
      camera.top = halfH;
      camera.bottom = -halfH;
      camera.updateProjectionMatrix();
    };
    st.applyFit = fit;
    fit();

    const render = () => {
      const iso = new THREE.Vector3(1, 1 + st.tilt * (STEEP_Y - 1), 1).normalize().multiplyScalar(240);
      camera.position.copy(st.target).add(iso);
      camera.lookAt(st.target);
      camera.updateProjectionMatrix();
      ghosts.sync();
      renderer.render(root, camera);
      container.dataset.draws = String(renderer.info.render.calls);
      container.dataset.tris = String(renderer.info.render.triangles);
      container.dataset.cam = `${camera.zoom.toFixed(2)} ${st.target.x.toFixed(1)} ${st.target.z.toFixed(1)}`;
      container.dataset.pos = `${st.pos.x.toFixed(1)} ${st.pos.z.toFixed(1)}`;
      updateLabels();
    };
    st.render = render;
    st.renderNow = render;

    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(hi, v));
    const updateLabels = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      const current = sceneRef.current;
      const v = new THREE.Vector3();
      const inset = st.insetTop;
      const next: Label[] = current.towers.map((t, i) => {
        const top = st.tops.get(t.id) ?? VOX_H * t.height;
        v.set(t.x, top + 0.4, t.z).project(camera);
        const px = (v.x * 0.5 + 0.5) * w;
        const py = (-v.y * 0.5 + 0.5) * h;
        return {
          id: t.id,
          n: i + 1,
          name: t.name,
          distanceM: t.distanceM,
          left: clamp(px, 24, w - 24),
          top: clamp(py, 24 + inset, h - 24),
          hide: st.follow && (px < 0 || px > w || py < inset || py > h),
        };
      });
      v.set(current.home.x, 7, current.home.z).project(camera);
      const hx = (v.x * 0.5 + 0.5) * w;
      const hy = (-v.y * 0.5 + 0.5) * h;
      const docked = hx < 0 || hx > w || hy < 0 || hy > h;
      const key =
        next.map((l) => `${l.id}:${Math.round(l.left)}:${Math.round(l.top)}:${l.hide ? 1 : 0}`).join("|") +
        `#${Math.round(hx)}:${Math.round(hy)}:${inset}`;
      if (key === st.labelKey) return;
      st.labelKey = key;
      setLabels(next);
      setHomeLabel(
        docked
          ? {
              ...(hx <= w / 2 ? { left: 8 } : { right: 8 }),
              ...(hy <= h / 2 ? { top: 8 + inset } : { bottom: 8 }),
              docked: true,
            }
          : {
              left: clamp(hx, 110, w - 110),
              top: clamp(hy, 40 + inset, h - 20),
              transform: "translate(-50%, -130%)",
              docked: false,
            },
      );
    };
    const renderNow = () => st.render();

    const densityOf = () => (container.clientWidth || 1) >= 1024 ? 1 : 0.5;
    const stopLoop = () => {
      if (st.lifeRaf) {
        cancelAnimationFrame(st.lifeRaf);
        st.lifeRaf = 0;
      }
    };
    const clearCamTimers = () => {
      st.camTimers.forEach((t) => window.clearTimeout(t));
      st.camTimers = [];
    };
    const clearGuard = () => {
      if (st.guard !== null) {
        window.clearTimeout(st.guard);
        st.guard = null;
      }
    };

    // ---- the user's trip: the character walks / rides the planned route and the camera follows at street level
    /** Where the camera rests once a trip is over: the tour's focus café, else the origin. */
    const overview = () => {
      const focus = st.lastFocus ? sceneRef.current.towers.find((t) => t.id === st.lastFocus) : null;
      return new THREE.Vector3(focus ? focus.x : 0, 0, focus ? focus.z : 0);
    };
    const easeBack = () => {
      clearCamTimers();
      st.camTimers.push(
        window.setTimeout(() => {
          st.camTimers = [];
          st.follow = false;
          const dest = overview();
          if (st.reduced) {
            st.target.copy(dest);
            camera.zoom = 1;
            st.tilt = 0;
            renderNow();
            return;
          }
          const from = st.target.clone();
          const zoom0 = camera.zoom;
          const tilt0 = st.tilt;
          let k = 0;
          const tick = () => {
            k++;
            st.target.lerpVectors(from, dest, k / EASE_BACK_STEPS);
            camera.zoom = zoom0 + ((1 - zoom0) * k) / EASE_BACK_STEPS;
            st.tilt = tilt0 * (1 - k / EASE_BACK_STEPS);
            renderNow();
            if (k < EASE_BACK_STEPS) st.camTimers.push(window.setTimeout(tick, EASE_BACK_MS));
          };
          tick();
        }, ARRIVE_HOLD_MS),
      );
    };
    const settle = (at: { x: number; z: number }) => {
      const done = st.trip;
      if (!done) return;
      st.trip = null;
      clearGuard();
      st.pos = { x: at.x, z: at.z };
      onTripRef.current?.(null);
      onArriveRef.current?.(done.id);
      if (st.follow) easeBack();
      else renderNow();
    };
    const stepTrip = (dt: number) => {
      if (!st.trip || !st.traveler) return;
      const s = st.traveler.update(dt);
      st.pos = { x: s.x, z: s.z };
      if (st.follow) {
        const k = 1 - Math.exp(-dt * FOLLOW_RATE);
        st.target.x += (s.x - st.target.x) * k;
        st.target.z += (s.z - st.target.z) * k;
        camera.zoom += (st.followZ - camera.zoom) * (1 - Math.exp(-dt * FOLLOW_ZOOM_RATE));
        st.tilt += (1 - st.tilt) * (1 - Math.exp(-dt * FOLLOW_ZOOM_RATE));
      }
      if (s.done) settle(s);
    };
    st.startTrip = (to) => {
      if (!st.traveler) return;
      clearCamTimers();
      clearGuard();
      const door: P = { x: to.x + CAFE_STEP, z: to.z + CAFE_STEP };
      const trip = tripFor(st.graph ?? EMPTY_GRAPH, st.pos, door, modeRef.current);
      if (trip.lengthM < ARRIVED_M) {
        st.trip = null;
        st.traveler.place(door.x, door.z);
        st.pos = door;
        onTripRef.current?.(null);
        onArriveRef.current?.(to.id);
        renderNow();
        return;
      }
      st.tripMode = modeRef.current;
      const info: TripInfo = { id: to.id, mode: trip.mode, lengthM: trip.lengthM, durationSec: trip.durationSec };
      st.trip = info;
      onTripRef.current?.(info);
      st.traveler.start(trip);
      if (st.reduced) {
        st.follow = false;
        settle(st.traveler.finish());
        return;
      }
      st.follow = true;
      st.followZ = followZoom(st.fitHalf);
      // A hidden tab or an off-screen map pauses the frame loop: finish the trip anyway so callers are never left waiting.
      st.guard = window.setTimeout(() => {
        st.guard = null;
        if (st.trip?.id === info.id && st.traveler) settle(st.traveler.finish());
      }, (trip.durationSec + 2) * 1000);
      startLoop();
    };
    st.cancelTrip = () => {
      if (!st.trip || !st.traveler) return;
      clearGuard();
      st.trip = null;
      st.traveler.place(st.pos.x, st.pos.z);
      onTripRef.current?.(null);
      if (st.follow) easeBack();
    };

    const setupLife = () => {
      if (st.reduced) return;
      const bucket = densityOf();
      if (st.life && bucket === st.densityBucket && st.lifeStreets === st.streets) return;
      if (st.life) {
        st.life.dispose();
        st.life = null;
      }
      if (!st.trip) stopLoop();
      st.densityBucket = bucket;
      st.lifeStreets = st.streets;
      if (!threeRef.current) return;
      const current = sceneRef.current;
      st.life = createLife({
        scene: root,
        streets: st.streets,
        spots: current.towers.map((t) => ({ id: t.id, x: t.x, z: t.z, height: t.height })),
        seed: seedFromString(current.home.label),
        density: bucket,
        palette: world,
      });
      if (st.visible && !document.hidden) startLoop();
    };
    const startLoop = () => {
      if (st.reduced || (!st.life && !st.trip) || st.lifeRaf || !st.visible || document.hidden) return;
      st.lastT = performance.now();
      let frames = 0;
      let ema = 60;
      const loop = (now: number) => {
        if (!threeRef.current || (!st.life && !st.trip)) {
          st.lifeRaf = 0;
          return;
        }
        st.lifeRaf = requestAnimationFrame(loop);
        const dt = Math.min((now - st.lastT) / 1000, 0.1);
        st.lastT = now;
        if (dt > 0) ema = ema * 0.95 + (1 / dt) * 0.05;
        frames++;
        if (frames % 60 === 0) container.dataset.fps = String(Math.round(ema));
        st.life?.update(dt);
        stepTrip(dt);
        render();
      };
      st.lifeRaf = requestAnimationFrame(loop);
    };
    st.setupLife = setupLife;

    /** The user took the camera: stop following and do not ease back over their view. */
    const takeCamera = () => {
      st.follow = false;
      clearCamTimers();
    };
    const onPointerDown = (e: PointerEvent) => {
      takeCamera();
      st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (st.pointers.size === 2) {
        const [a, b] = [...st.pointers.values()];
        st.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      const prev = st.pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const h = container.clientHeight || 1;
      if (st.pointers.size === 2) {
        const [a, b] = [...st.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (st.pinchDist && st.pinchDist > 0) {
          camera.zoom = clampZoom(camera.zoom * (dist / st.pinchDist));
        }
        st.pinchDist = dist;
        renderNow();
        return;
      }
      const wpp = (camera.top * 2) / h / camera.zoom;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      right.y = 0;
      right.normalize();
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      up.y = 0;
      up.normalize();
      st.target.addScaledVector(right, -dx * wpp);
      st.target.addScaledVector(up, dy * wpp);
      st.target.x = Math.min(st.panLimit, Math.max(-st.panLimit, st.target.x));
      st.target.z = Math.min(st.panLimit, Math.max(-st.panLimit, st.target.z));
      renderNow();
    };
    const onPointerUp = (e: PointerEvent) => {
      st.pointers.delete(e.pointerId);
      st.pinchDist = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      takeCamera();
      camera.zoom = clampZoom(camera.zoom * Math.exp(-e.deltaY * 0.001));
      renderNow();
    };
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const observer = new ResizeObserver(() => {
      fit();
      renderNow();
      void setupLife();
    });
    observer.observe(container);
    const viewObserver = new IntersectionObserver(
      (entries) => {
        st.visible = entries.some((e) => e.isIntersecting);
        if (st.visible && !document.hidden) startLoop();
        else if (!st.visible) stopLoop();
      },
      { threshold: 0 },
    );
    viewObserver.observe(container);
    const onVisibility = () => {
      if (document.hidden) stopLoop();
      else if (st.visible) startLoop();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      observer.disconnect();
      viewObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stopLoop();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      const stNow = threeRef.current;
      if (stNow) {
        stNow.stepTimers.forEach((t) => window.clearTimeout(t));
        clearCamTimers();
        clearGuard();
        stNow.trip = null;
        stNow.traveler?.dispose();
        stNow.traveler = null;
        if (stNow.life) {
          stNow.life.dispose();
          stNow.life = null;
        }
      }
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const mat = mesh.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
      renderer.dispose();
      if (canvas.parentElement === container) container.removeChild(canvas);
      threeRef.current = null;
    };
  }, []);

  // The real town is built once per area (geo changes), never per turn.
  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;
    // The street graph is built once per area; the procedural town builds its own from its plan.
    st.graph = geo ? buildGraph(polylinesFromSnapshot(geo)) : null;
    if (!geo) {
      st.realTown = null;
      return;
    }
    const town = buildRealTown(geo, st.world);
    st.root.add(town.group);
    st.realTown = town;
    st.streets = town.streets;
    return () => {
      st.root.remove(town.group);
      town.dispose();
      if (st.realTown === town) st.realTown = null;
    };
  }, [geo]);

  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;
    const renderNow = () => st.render();
    const { palette, world } = st;

    // Re-frame (overview, centred on home) whenever this week's set of cafes changes; a verdict never moves the camera.
    const framed = scene.towers.filter((t) => t.live !== false);
    const fitKey = `${fitScene(scene).halfSize.toFixed(2)}:${framed.map((t) => t.id).join(",")}`;
    st.panLimit = Math.max(fitAllScene(scene).halfSize, 12);
    if (fitKey !== st.fitKey) {
      st.fitKey = fitKey;
      st.camera.zoom = 1;
      st.target.set(0, 0, 0);
    }
    st.applyFit();

    // Clear the previous turn's stepped timers first, so the focus move started below is not cancelled mid-way.
    st.stepTimers.forEach((t) => window.clearTimeout(t));
    st.stepTimers = [];
    const focusTower = focusId ? scene.towers.find((t) => t.id === focusId) ?? null : null;
    if (focusId !== st.lastFocus) {
      const hadFocus = st.lastFocus !== null;
      st.lastFocus = focusId;
      if (focusTower || hadFocus) {
        const dest = new THREE.Vector3(focusTower ? focusTower.x : 0, 0, focusTower ? focusTower.z : 0);
        if (st.reduced) {
          st.target.copy(dest);
          renderNow();
        } else {
          const from = st.target.clone();
          let fstep = 0;
          const ftick = () => {
            fstep++;
            st.target.lerpVectors(from, dest, fstep / 3);
            renderNow();
            if (fstep < 3) st.stepTimers.push(window.setTimeout(ftick, 100));
          };
          ftick();
        }
      }
    }

    if (st.content) {
      st.root.remove(st.content);
      st.content.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        }
      });
    }
    const content = new THREE.Group();
    st.content = content;
    st.tops = new Map();
    st.bases = new Map();

    const counts = scene.towers.map((t) => towerVoxels(t, palette).count);
    if (st.proc) {
      st.root.remove(st.proc);
      st.proc.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        }
      });
      st.proc = null;
    }
    if (st.realTown) {
      // Café towers stay the tallest nearby: neighbours are capped one voxel below the tower.
      const spots: CafeSpot[] = scene.towers.map((t, i) => ({
        x: t.x,
        z: t.z,
        clear: counts[i] <= 3 ? 7.5 : counts[i] <= 5 ? 6 : 4.5,
        cap: Math.max(0.8, counts[i] - 1),
      }));
      // The home house stands in a cleared plaza; its neighbours keep their heights.
      spots.push({ x: 0, z: 0, clear: HOME_CLEAR, cap: Infinity });
      st.realTown.update(spots);
    } else {
      const cafes: TownCafe[] = scene.towers.map((t, i) => ({
        x: t.x,
        z: t.z,
        clear: counts[i] <= 3 ? 7.5 : counts[i] <= 5 ? 6 : 4.5,
        cap: Math.min(6, Math.max(2, counts[i])),
      }));
      const townPlan = planTown({ seed: seedFromString(scene.home.label), half: 90, cafes });
      st.streets = townPlan.streets;
      if (!st.graph) st.graph = buildGraph(streetPolylines(townPlan.streets));
      st.proc = buildTown(townPlan, townPalette(world), cafes).group;
      st.root.add(st.proc);
    }

    const targets = new Map<string, { count: number; colors: string[]; marker: boolean }>();
    for (const tower of scene.towers) targets.set(tower.id, towerVoxels(tower, palette));

    const paintTowers = (counts: Map<string, number>) => {
      for (let i = content.children.length - 1; i >= 0; i--) {
        const child = content.children[i];
        if ((child as THREE.Mesh).isMesh && child.userData.layer === "towers") {
          content.remove(child);
          const mesh = child as THREE.Mesh;
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        }
      }
      let total = 0;
      for (const [id, n] of counts) {
        total += n + (targets.get(id)?.marker ? 1 : 0);
      }
      if (total === 0) return;
      const mesh = boxMesh(total, "#ffffff");
      mesh.userData.layer = "towers";
      let i = 0;
      for (const tower of scene.towers) {
        const spec = targets.get(tower.id);
        if (!spec) continue;
        const n = counts.get(tower.id) ?? 0;
        const base = LOT_Y;
        st.bases.set(tower.id, base);
        for (let v = 0; v < n; v++) {
          place(mesh, i, tower.x, base + v * VOX_H + VOX_H / 2, tower.z, VOX, VOX_H, VOX, spec.colors[Math.min(v, spec.colors.length - 1)] ?? palette.ink2);
          i++;
        }
        if (spec.marker && n > 0) {
          place(mesh, i, tower.x, base + n * VOX_H + VOX_H / 2, tower.z, VOX * 0.55, VOX_H, VOX * 0.55, palette.accent2);
          i++;
        }
        st.tops.set(tower.id, base + Math.max(n, 1) * VOX_H + (spec.marker && n > 0 ? VOX_H : 0));
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      content.add(mesh);
    };

    const finalCounts = new Map<string, number>();
    for (const [id, spec] of targets) finalCounts.set(id, spec.count);

    if (st.reduced) {
      paintTowers(finalCounts);
      st.prevCounts = finalCounts;
    } else {
      const from = st.prevCounts;
      let step = 0;
      const tick = () => {
        step++;
        const counts = new Map<string, number>();
        for (const [id, spec] of targets) {
          const a = from.get(id) ?? 0;
          counts.set(id, Math.round(a + ((spec.count - a) * step) / RISE_STEPS));
        }
        paintTowers(counts);
        renderNow();
        if (step < RISE_STEPS) {
          st.stepTimers.push(window.setTimeout(tick, RISE_MS));
        } else {
          st.prevCounts = finalCounts;
        }
      };
      tick();
    }

    const beamTowers = scene.towers.filter((t) => t.status === "loved" || t.status === "revisit");
    if (beamTowers.length > 0) {
      const segs = 14;
      const mesh = boxMesh(beamTowers.length * segs, palette.accent);
      mesh.userData.layer = "beams";
      let i = 0;
      for (const tower of beamTowers) {
        const top = st.tops.get(tower.id) ?? VOX_H * tower.height;
        for (let s = 0; s < segs; s++) {
          const f = (s + 1) / (segs + 1);
          const x = scene.home.x + (tower.x - scene.home.x) * f;
          const z = scene.home.z + (tower.z - scene.home.z) * f;
          const y = Math.max(8, 6 + (top - 6) * f);
          place(mesh, i, x, y, z, 0.45, 0.45, 0.45, palette.accent);
          i++;
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      content.add(mesh);
    }

    if (focusTower) {
      const segs = 10;
      const mesh = boxMesh(segs, palette.accent);
      mesh.userData.layer = "finale";
      const base = LOT_Y;
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        place(
          mesh, s,
          focusTower.x + Math.cos(a) * VOX * 1.6, base + 0.28, focusTower.z + Math.sin(a) * VOX * 1.6,
          0.55, 0.55, 0.55,
          palette.accent,
        );
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      content.add(mesh);
    }

    if (st.realTown && scene.towers.length > 0) {
      const lots = boxMesh(scene.towers.length + 2, world.sidewalk);
      lots.userData.layer = "lots";
      scene.towers.forEach((t, i) => place(lots, i, t.x, LOT_Y / 2, t.z, 3.4, LOT_Y, 3.4, world.sidewalk));
      place(lots, scene.towers.length, scene.home.x, LOT_Y / 2, scene.home.z, 3.4, LOT_Y, 3.4, world.sidewalk);
      place(lots, scene.towers.length + 1, 0, LOT_Y / 2, 0, HOME_PAD, LOT_Y, HOME_PAD, world.sidewalk);
      lots.instanceMatrix.needsUpdate = true;
      if (lots.instanceColor) lots.instanceColor.needsUpdate = true;
      content.add(lots);
    }

    const homeBase = LOT_Y;
    const homeMesh = boxMesh(5, palette.accent2);
    homeMesh.userData.layer = "home";
    for (let v = 0; v < 5; v++) {
      place(homeMesh, v, scene.home.x, homeBase + v * VOX_H + VOX_H / 2, scene.home.z, VOX, VOX_H, VOX, palette.accent2);
    }
    homeMesh.instanceMatrix.needsUpdate = true;
    if (homeMesh.instanceColor) homeMesh.instanceColor.needsUpdate = true;
    content.add(homeMesh);
    content.add(houseMesh(world));

    st.root.add(content);
    if (st.life) {
      st.life.setSpots(scene.towers.map((t) => ({ id: t.id, x: t.x, z: t.z, height: t.height })));
    }
    renderNow();
    onReadyRef.current?.();
    st.setupLife();
  }, [scene, geo, focusId]);

  // Send the character to a café: a change to a new id starts a trip, null cancels the one under way.
  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;
    if (!travelTo) {
      st.travelKey = null;
      st.cancelTrip();
      return;
    }
    if (travelTo === st.travelKey) return;
    const tower = scene.towers.find((t) => t.id === travelTo);
    if (!tower) return;
    st.travelKey = travelTo;
    st.startTrip(tower);
  }, [travelTo, scene]);

  // Switching mode mid-trip re-plans from where the character is now.
  useEffect(() => {
    const st = threeRef.current;
    const id = st?.trip?.id;
    if (!st || !id || st.tripMode === travelMode) return;
    const tower = sceneRef.current.towers.find((t) => t.id === id);
    if (tower) st.startTrip(tower);
  }, [travelMode]);

  // A floating bar's height keeps labels clear of it.
  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;
    st.readInset();
    st.labelKey = "";
    st.renderNow();
  }, [insetTop]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <div
        className="ui-meta pointer-events-none absolute z-10 px-2 py-1"
        style={{
          left: homeLabel.left,
          top: homeLabel.top,
          right: homeLabel.right,
          bottom: homeLabel.bottom,
          transform: homeLabel.transform,
          background: "var(--c-ink)",
          color: "var(--c-canvas)",
        }}
      >
        {homeLabel.docked ? scene.home.short : scene.home.label}
      </div>
      {labels.map((label) => {
        const open = label.id === selectedId || label.id === hoverId || label.id === focusId;
        // While the camera follows the character, tags of towers out of view stay out of the way.
        if (label.hide && !open) return null;
        if (!open) {
          return (
            <button
              key={label.id}
              type="button"
              onClick={() => onSelectRef.current(label.id)}
              onMouseEnter={() => setHoverId(label.id)}
              onMouseLeave={() => setHoverId((h) => (h === label.id ? null : h))}
              onFocus={() => setHoverId(label.id)}
              onBlur={() => setHoverId((h) => (h === label.id ? null : h))}
              aria-label={`${label.n}: ${label.name}, ${Math.round(label.distanceM)} metres`}
              className="absolute z-10 flex items-center justify-center"
              style={{
                left: label.left,
                top: label.top,
                transform: "translate(-50%, -100%)",
                minWidth: 44,
                minHeight: 44,
                background: "transparent",
                border: "0",
                padding: 0,
                cursor: "pointer",
              }}
            >
              <span
                aria-hidden="true"
                className="ui-meta flex items-center justify-center"
                style={{
                  width: 26,
                  height: 26,
                  background: "var(--c-surface)",
                  border: "2px solid var(--c-line-strong)",
                  color: "var(--c-ink)",
                }}
              >
                {label.n}
              </span>
            </button>
          );
        }
        return (
          <button
            key={label.id}
            type="button"
            onClick={() => onSelectRef.current(label.id)}
            onMouseEnter={() => setHoverId(label.id)}
            onMouseLeave={() => setHoverId((h) => (h === label.id ? null : h))}
            onFocus={() => setHoverId(label.id)}
            onBlur={() => setHoverId((h) => (h === label.id ? null : h))}
            aria-pressed={label.id === selectedId}
            className="ui-meta absolute z-10"
            style={{
              left: label.left,
              top: label.top,
              transform: "translate(-50%, 10px)",
              minWidth: 44,
              minHeight: 44,
              padding: "8px 10px",
              background: "var(--c-surface)",
              border: "2px solid var(--c-line-strong)",
              outline: label.id === selectedId ? "2px solid var(--c-accent)" : "none",
              outlineOffset: 2,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {compactLabel(label.name, label.distanceM)}
          </button>
        );
      })}
    </div>
  );
}
