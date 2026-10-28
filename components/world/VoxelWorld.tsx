"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { cameraMoved, clampZoom, compactLabel, fitAllScene, fitScene, followZoom, isTap, isoFit, placeClear, wheelZoomFactor, zoomStepFactor, type Box } from "../../lib/world";
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

/** `arrow` (degrees, 0 = right): the tag cannot sit on its tower (a panel or the screen edge is in the way), so a small edge arrow points to it. */
type Label = { id: string; n: number; name: string; distanceM: number; left: number; top: number; hide: boolean; arrow?: number };
const MAX_ARROWS = 3;
const dirGlyph = (dx: number, dy: number) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "◂" : "▸") : dy < 0 ? "▴" : "▾");

const VOX = 1.8;
const VOX_H = 1;
const LOT_Y = 0.22;
/** How much the ink hull outgrows a tower voxel (scene units, both sides together). */
const HULL_W = 0.2;
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
const ROTATE_STEPS = 6;
const ROTATE_MS = 40;
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
  /** Café id of each instance in the solid tower mesh, so a ray hit maps back to its café. */
  towerOwners: string[];
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
  /** Camera dock: zoom by a factor, glide back to the overview, or take the character back into the follow camera. */
  zoomBy: (factor: number) => void;
  /** Quarter-turn the camera round the home: +1 counter-clockwise, -1 clockwise (seen from above). */
  rotate: (dir: 1 | -1) => void;
  /** Camera turn in quarter-turns (whole number) and the angle drawn right now (radians, moves between quarters). */
  quarter: number;
  angle: number;
  goHome: () => void;
  refollow: () => void;
};

/** The camera dock's buttons light up only when there is something to undo. */
type CamUi = { moved: boolean; trip: boolean; following: boolean };
const UP = new THREE.Vector3(0, 1, 0);
const KEY_PAN_FRACTION = 0.12;
const DOCK_BTN = { minWidth: 44, minHeight: 44, padding: 0, justifyContent: "center", fontSize: 20, lineHeight: 1 } as const;

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
  const [you, setYou] = useState<{ left: number; top: number } | null>(null);
  const [house, setHouse] = useState<{ left: number; top: number; dir: string } | null>(null);
  const keyRef = useRef<HTMLParagraphElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const prioRef = useRef<(string | null | undefined)[]>([]);
  prioRef.current = [selectedId, focusId];
  const [homeLabel, setHomeLabel] = useState<{
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
    transform?: string;
    docked?: boolean;
    dir?: string;
    hidden?: boolean;
  }>({ left: 0, top: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [camUi, setCamUi] = useState<CamUi>({ moved: false, trip: false, following: false });
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
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("role", "application");
    renderer.domElement.setAttribute("aria-label", "Map. Arrow keys pan, plus and minus zoom, Q and E turn, 0 returns to the overview.");
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
      towerOwners: [],
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
      zoomBy: () => {},
      rotate: () => {},
      quarter: 0,
      angle: 0,
      goHome: () => {},
      refollow: () => {},
    };
    threeRef.current = st;

    const readInset = () => {
      st.insetTop = Math.max(0, parseFloat(getComputedStyle(container).getPropertyValue("--stage-inset-top")) || 0);
    };
    st.readInset = readInset;
    readInset();

    const aspectNow = () => Math.max((container.clientWidth || 1) / (container.clientHeight || 1), 0.2);
    const setHalf = (half: number) => {
      st.fitHalf = half;
      const aspect = aspectNow();
      camera.left = -half;
      camera.right = half;
      camera.top = half / aspect;
      camera.bottom = -half / aspect;
      camera.updateProjectionMatrix();
    };
    const fit = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w < 640 ? 1.5 : 2));
      renderer.setSize(w, h, false);
      setHalf(isoFit(sceneRef.current, aspectNow(), st.quarter));
    };
    st.applyFit = fit;
    fit();

    const render = () => {
      const iso = new THREE.Vector3(1, 1 + st.tilt * (STEEP_Y - 1), 1).normalize().multiplyScalar(240).applyAxisAngle(UP, st.angle);
      camera.position.copy(st.target).add(iso);
      camera.lookAt(st.target);
      camera.updateProjectionMatrix();
      ghosts.sync();
      st.realTown?.setZoom(camera.zoom);
      renderer.render(root, camera);
      container.dataset.draws = String(renderer.info.render.calls);
      container.dataset.tris = String(renderer.info.render.triangles);
      container.dataset.cam = `${camera.zoom.toFixed(2)} ${st.target.x.toFixed(1)} ${st.target.z.toFixed(1)}`;
      container.dataset.pos = `${st.pos.x.toFixed(1)} ${st.pos.z.toFixed(1)}`;
      const home = overview();
      const moved = cameraMoved(camera.zoom, st.tilt, Math.hypot(st.target.x - home.x, st.target.z - home.z), st.quarter);
      const trip = st.trip !== null;
      setCamUi((u) => (u.moved === moved && u.trip === trip && u.following === st.follow ? u : { moved, trip, following: st.follow }));
      updateLabels();
    };
    st.render = render;
    st.renderNow = render;

    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(hi, v));
    // Floating panels, the key, the data credit and the camera dock cover the world; labels keep out of their rects (refreshed every 200 ms).
    let clearAt = -1e9;
    let clearRects: Box[] = [];
    const clearOf = (w: number, h: number): Box[] => {
      const now = performance.now();
      if (now - clearAt < 200) return clearRects;
      clearAt = now;
      const cr = container.getBoundingClientRect();
      const rel = (r: DOMRect): Box => ({ left: r.left - cr.left, top: r.top - cr.top, right: r.right - cr.left, bottom: r.bottom - cr.top });
      const out: Box[] = [];
      document.querySelectorAll<HTMLElement>(".ui-panel, [data-camera-dock]").forEach((el) => {
        if (el.contains(container)) return;
        const r = rel(el.getBoundingClientRect());
        if (r.right - r.left > 2 && r.bottom - r.top > 2 && r.right > 0 && r.left < w && r.bottom > 0 && r.top < h) out.push(r);
      });
      const probe = probeRef.current;
      if (probe) {
        const base = rel(probe.getBoundingClientRect()).bottom;
        out.push({ left: 0, top: base - 28, right: 244, bottom: h });
      }
      const k = keyRef.current;
      if (k && k.offsetParent) out.push(rel(k.getBoundingClientRect()));
      clearRects = out;
      return out;
    };
    const updateLabels = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      const current = sceneRef.current;
      const v = new THREE.Vector3();
      const inset = st.insetTop;
      const panels = clearOf(w, h);
      const bounds: Box = { left: 8, top: 8 + inset, right: w - 8, bottom: h - 8 };
      const boxAt = (x: number, y: number, hw: number, hh: number): Box => ({ left: x - hw, top: y - hh, right: x + hw, bottom: y + hh });
      const placed: Box[] = [];
      const spots = current.towers.map((t) => {
        const top = st.tops.get(t.id) ?? VOX_H * t.height;
        v.set(t.x, top + 0.4, t.z).project(camera);
        const px = (v.x * 0.5 + 0.5) * w;
        const py = (-v.y * 0.5 + 0.5) * h;
        // The tag is 26 px tall and stands on the tower top; if a panel or the screen edge covers that spot it becomes an arrow.
        const spot = placeClear(px, py - 13, 16, 16, panels, bounds);
        const ok = spot !== null && Math.hypot(spot.x - px, spot.y + 13 - py) < 8;
        if (ok) placed.push(boxAt(px, py - 13, 16, 16));
        return { px, py, ok };
      });
      v.set(current.home.x, 7, current.home.z).project(camera);
      const hx = (v.x * 0.5 + 0.5) * w;
      const hy = (-v.y * 0.5 + 0.5) * h;
      const wideChip = w >= 640;
      const off = hx < 0 || hx > w || hy < 0 || hy > h;
      // The old regular's label: full text over its beacon, short text with a direction mark when it has to sit away from it.
      const withTags = [...panels, ...placed];
      const full = placeClear(hx, hy - 18, wideChip ? 150 : 80, 12, withTags, bounds);
      const near = !off && full !== null && Math.hypot(full.x - hx, full.y + 18 - hy) < 8;
      const short = near ? full : placeClear(hx, hy, 80, 12, withTags, bounds);
      const docked = !near;
      const homeAt = short ?? { x: 0, y: 0 };
      const homeDir = !near && short ? dirGlyph(hx - short.x, hy - short.y) : "";
      if (short) placed.push(boxAt(short.x, short.y, near ? (wideChip ? 150 : 80) : 80, 12));
      // Edge arrows avoid panels, the tags already in place, the old-regular label and each other.
      const next: Label[] = current.towers.map((t, i) => {
        const base = { id: t.id, n: i + 1, name: t.name, distanceM: t.distanceM };
        const { px, py, ok } = spots[i];
        if (ok) return { ...base, left: px, top: py, hide: false };
        return { ...base, left: 0, top: 0, hide: true, arrow: undefined as number | undefined };
      });
      // At most three arrows: the chosen or focused café first, then the nearest.
      const prio = prioRef.current;
      const order = next
        .map((l, i) => i)
        .filter((i) => !spots[i].ok)
        .sort((i, j) => Number(prio.includes(next[j].id)) - Number(prio.includes(next[i].id)) || next[i].distanceM - next[j].distanceM);
      let arrows = 0;
      for (const i of order) {
        if (arrows >= MAX_ARROWS) break;
        const { px, py } = spots[i];
        const edge = placeClear(px, py - 13, 38, 13, [...panels, ...placed], bounds, 6);
        if (!edge) continue;
        placed.push(boxAt(edge.x, edge.y, 38, 13));
        arrows++;
        next[i] = { ...next[i], left: edge.x, top: edge.y, hide: false, arrow: (Math.atan2(py - 13 - edge.y, px - edge.x) * 180) / Math.PI };
      }
      // The traveller's "You" tag hangs from the little diamond that floats over the character, so it follows the taxi and the bus too.
      const marker = root.getObjectByName("traveler:marker");
      let yx = -1;
      let yy = -1;
      let youSpot: { x: number; y: number } | null = null;
      if (marker && (st.trip || Math.hypot(st.pos.x, st.pos.z) > 4)) {
        marker.getWorldPosition(v);
        v.project(camera);
        yx = (v.x * 0.5 + 0.5) * w;
        yy = (-v.y * 0.5 + 0.5) * h;
        const spot = placeClear(yx, yy - 22, 28, 18, panels, bounds);
        if (spot && Math.hypot(spot.x - yx, spot.y + 22 - yy) < 8) youSpot = { x: yx, y: yy };
      }
      // The little house is "your place".
      v.set(0, 3.2, 0).project(camera);
      const bx = (v.x * 0.5 + 0.5) * w;
      const by = (-v.y * 0.5 + 0.5) * h;
      const houseSpot = placeClear(bx, by - 11, 52, 12, [...panels, ...placed], bounds);
      const houseAt = houseSpot ? { left: houseSpot.x, top: houseSpot.y, dir: Math.hypot(houseSpot.x - bx, houseSpot.y - (by - 11)) < 8 ? "" : dirGlyph(bx - houseSpot.x, by - 11 - houseSpot.y) } : null;
      const key =
        next.map((l) => `${l.id}:${Math.round(l.left)}:${Math.round(l.top)}:${l.hide ? 1 : 0}:${Math.round(l.arrow ?? 999)}`).join("|") +
        `#${Math.round(homeAt.x)}:${Math.round(homeAt.y)}:${docked ? 1 : 0}:${short ? 1 : 0}:${homeDir}:${inset}:${youSpot ? `${Math.round(yx)}:${Math.round(yy)}` : "-"}:${houseAt ? `${Math.round(houseAt.left)}:${Math.round(houseAt.top)}:${houseAt.dir}` : "-"}`;
      if (key === st.labelKey) return;
      st.labelKey = key;
      setLabels(next);
      setYou(youSpot ? { left: youSpot.x, top: youSpot.y } : null);
      setHouse(houseAt);
      setHomeLabel({ left: homeAt.x, top: homeAt.y, transform: "translate(-50%, -50%)", docked, dir: homeDir, hidden: short === null });
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
    /** Glide (or jump, under reduced motion) back to the resting overview. */
    const glideHome = () => {
      st.camTimers = [];
      st.follow = false;
      const dest = overview();
      const angleTo = Math.PI * 2 * Math.round(st.angle / (Math.PI * 2));
      st.quarter = 0;
      const halfTo = isoFit(sceneRef.current, aspectNow(), 0);
      if (st.reduced) {
        st.target.copy(dest);
        camera.zoom = 1;
        st.tilt = 0;
        st.angle = angleTo;
        setHalf(halfTo);
        renderNow();
        return;
      }
      const from = st.target.clone();
      const zoom0 = camera.zoom;
      const tilt0 = st.tilt;
      const angle0 = st.angle;
      const half0 = st.fitHalf;
      let k = 0;
      const tick = () => {
        k++;
        const f = k / EASE_BACK_STEPS;
        st.target.lerpVectors(from, dest, f);
        camera.zoom = zoom0 + (1 - zoom0) * f;
        st.tilt = tilt0 * (1 - f);
        st.angle = angle0 + (angleTo - angle0) * f;
        setHalf(half0 + (halfTo - half0) * f);
        renderNow();
        if (k < EASE_BACK_STEPS) st.camTimers.push(window.setTimeout(tick, EASE_BACK_MS));
      };
      tick();
    };
    /** Turn the camera a quarter round the home, refitting as it goes so the cafes stay in frame at every turn. */
    st.rotate = (dir) => {
      takeCamera();
      const index = Math.round(st.angle / (Math.PI / 2)) + dir;
      const angleTo = index * (Math.PI / 2);
      st.quarter = ((index % 4) + 4) % 4;
      const halfTo = isoFit(sceneRef.current, aspectNow(), st.quarter);
      if (st.reduced) {
        st.angle = angleTo;
        setHalf(halfTo);
        renderNow();
        return;
      }
      const angle0 = st.angle;
      const half0 = st.fitHalf;
      let k = 0;
      const tick = () => {
        k++;
        const f = k / ROTATE_STEPS;
        st.angle = angle0 + (angleTo - angle0) * f;
        setHalf(half0 + (halfTo - half0) * f);
        renderNow();
        if (k < ROTATE_STEPS) st.camTimers.push(window.setTimeout(tick, ROTATE_MS));
      };
      tick();
    };
    const easeBack = () => {
      clearCamTimers();
      st.camTimers.push(window.setTimeout(glideHome, ARRIVE_HOLD_MS));
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
    st.zoomBy = (factor) => {
      takeCamera();
      camera.zoom = clampZoom(camera.zoom * factor);
      renderNow();
    };
    st.goHome = () => {
      clearCamTimers();
      glideHome();
    };
    st.refollow = () => {
      if (!st.trip || st.reduced) return;
      clearCamTimers();
      st.follow = true;
      st.followZ = followZoom(st.fitHalf);
      startLoop();
    };
    /** Keyboard: arrows pan, + / - zoom, 0 or Home returns to the overview. */
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      const dir = arrows[e.key];
      if (dir) {
        takeCamera();
        const step = KEY_PAN_FRACTION * (camera.right * 2) / camera.zoom;
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0).setY(0).normalize();
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1).setY(0).normalize();
        st.target.addScaledVector(right, dir[0] * step).addScaledVector(up, dir[1] * step);
        st.target.x = Math.min(st.panLimit, Math.max(-st.panLimit, st.target.x));
        st.target.z = Math.min(st.panLimit, Math.max(-st.panLimit, st.target.z));
        renderNow();
      } else if (e.key === "+" || e.key === "=") st.zoomBy(zoomStepFactor(1));
      else if (e.key === "-" || e.key === "_") st.zoomBy(zoomStepFactor(-1));
      else if (e.key === "q" || e.key === "Q") st.rotate(-1);
      else if (e.key === "e" || e.key === "E") st.rotate(1);
      else if (e.key === "0" || e.key === "Home") st.goHome();
      else return;
      e.preventDefault();
    };
    /** Which café's solid tower is under this screen point (outline or hull meshes are not in the test: only layer "towers"). */
    const towerAt = (clientX: number, clientY: number): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height || !st.content) return null;
      const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      const solid = st.content.children.filter((c) => c.userData.layer === "towers");
      if (solid.length === 0) return null;
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(solid, false)[0];
      return hit?.instanceId !== undefined ? (st.towerOwners[hit.instanceId] ?? null) : null;
    };
    let down: { id: number; x: number; y: number; t: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      down = st.pointers.size === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
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
      if (!prev) {
        if (e.pointerType === "mouse") canvas.style.cursor = towerAt(e.clientX, e.clientY) ? "pointer" : "grab";
        return;
      }
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
      const tap = down;
      down = null;
      if (e.type === "pointerup" && tap && tap.id === e.pointerId && isTap(tap, { x: e.clientX, y: e.clientY, t: performance.now() })) {
        const id = towerAt(e.clientX, e.clientY);
        if (id) onSelectRef.current(id);
      }
      st.pointers.delete(e.pointerId);
      st.pinchDist = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      takeCamera();
      camera.zoom = clampZoom(camera.zoom * wheelZoomFactor(e.deltaY));
      renderNow();
    };
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKeyDown);
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
      canvas.removeEventListener("keydown", onKeyDown);
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
      // Ink hull: the same boxes grown a little, drawn back-faces only in the outline colour, so every tower gets a bold silhouette.
      const hull = boxMesh(total, world.outline);
      hull.userData.layer = "towers";
      (hull.material as THREE.Material).dispose();
      hull.material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide });
      let i = 0;
      const owners: string[] = [];
      for (const tower of scene.towers) {
        const spec = targets.get(tower.id);
        if (!spec) continue;
        const n = counts.get(tower.id) ?? 0;
        const base = LOT_Y;
        st.bases.set(tower.id, base);
        for (let v = 0; v < n; v++) {
          place(mesh, i, tower.x, base + v * VOX_H + VOX_H / 2, tower.z, VOX, VOX_H, VOX, spec.colors[Math.min(v, spec.colors.length - 1)] ?? palette.ink2);
          place(hull, i, tower.x, base + v * VOX_H + VOX_H / 2, tower.z, VOX + HULL_W, VOX_H + HULL_W, VOX + HULL_W, world.outline);
          owners[i] = tower.id;
          i++;
        }
        if (spec.marker && n > 0) {
          place(mesh, i, tower.x, base + n * VOX_H + VOX_H / 2, tower.z, VOX * 0.55, VOX_H, VOX * 0.55, palette.accent2);
          place(hull, i, tower.x, base + n * VOX_H + VOX_H / 2, tower.z, VOX * 0.55 + HULL_W, VOX_H + HULL_W, VOX * 0.55 + HULL_W, world.outline);
          owners[i] = tower.id;
          i++;
        }
        st.tops.set(tower.id, base + Math.max(n, 1) * VOX_H + (spec.marker && n > 0 ? VOX_H : 0));
      }
      mesh.count = i;
      st.towerOwners = owners;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      hull.count = i;
      hull.instanceMatrix.needsUpdate = true;
      if (hull.instanceColor) hull.instanceColor.needsUpdate = true;
      content.add(hull, mesh);
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

    if (st.realTown) {
      const trees = st.realTown.trees(scene.towers);
      if (trees.length > 0) {
        const grove = boxMesh(trees.length, world.trunk);
        grove.userData.layer = "trees";
        trees.forEach((t, i) => place(grove, i, t.x, t.y, t.z, t.sx, t.sy, t.sz, t.color));
        grove.instanceMatrix.needsUpdate = true;
        if (grove.instanceColor) grove.instanceColor.needsUpdate = true;
        content.add(grove);
      }
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
        role="group"
        aria-label="Camera"
        className="absolute z-10 flex-col"
        data-camera-dock
        style={{ display: "var(--camera-dock-display, flex)", right: "calc(var(--stage-inset-right, 0px) + 8px)", bottom: "calc(var(--stage-inset-bottom, 0px) + 44px)", gap: 6 }}
      >
        {camUi.trip && !camUi.following && (
          <button type="button" className="ui-btn ui-btn--primary" style={{ minHeight: 44 }} onClick={() => threeRef.current?.refollow()}>
            Follow
          </button>
        )}
        <button type="button" className="ui-btn" aria-label="Zoom in" style={DOCK_BTN} onClick={() => threeRef.current?.zoomBy(zoomStepFactor(1))}>
          +
        </button>
        <button type="button" className="ui-btn" aria-label="Zoom out" style={DOCK_BTN} onClick={() => threeRef.current?.zoomBy(zoomStepFactor(-1))}>
          &minus;
        </button>
        <button type="button" className="ui-btn" aria-label="Turn the view a quarter" title="Turn the view (Q / E)" style={DOCK_BTN} onClick={() => threeRef.current?.rotate(1)}>
          &#8635;
        </button>
        <button
          type="button"
          className="ui-btn"
          aria-label="Back to overview"
          disabled={!camUi.moved}
          style={{ ...DOCK_BTN, fontSize: "var(--fs-xs)" }}
          onClick={() => threeRef.current?.goHome()}
        >
          Reset
        </button>
      </div>
      <div
        className="ui-meta pointer-events-none absolute z-10 px-2 py-1"
        style={{
          left: homeLabel.left,
          top: homeLabel.top,
          transform: homeLabel.transform,
          background: "var(--c-ink)",
          color: "var(--c-canvas)",
          whiteSpace: "nowrap",
          display: homeLabel.hidden ? "none" : undefined,
        }}
      >
        {homeLabel.dir === "◂" && <span aria-hidden="true">◂ </span>}
        <span aria-hidden="true">◆ </span>
        {homeLabel.docked ? (
          `Old regular · ${scene.home.short}`
        ) : (
          <>
            <span className="max-sm:hidden">Your old regular · {scene.home.label}</span>
            <span className="sm:hidden">Old regular · {scene.home.short}</span>
          </>
        )}
        {homeLabel.dir && homeLabel.dir !== "◂" && <span aria-hidden="true"> {homeLabel.dir}</span>}
      </div>
      {house && (
        <div
          aria-hidden="true"
          className="ui-meta pointer-events-none absolute z-10"
          style={{
            left: house.left,
            top: house.top,
            transform: "translate(-50%, -50%)",
            background: "var(--c-surface)",
            color: "var(--w-home)",
            border: "2px solid var(--w-home)",
            padding: "0 6px",
            whiteSpace: "nowrap",
          }}
        >
          {house.dir === "◂" && "◂ "}⌂ Your place{house.dir && house.dir !== "◂" ? ` ${house.dir}` : ""}
        </div>
      )}
      {you && (
        <div
          aria-hidden="true"
          className="ui-meta pointer-events-none absolute z-10 flex flex-col items-center"
          style={{ left: you.left, top: you.top, transform: "translate(-50%, -100%)" }}
        >
          <span
            className="flex items-center"
            style={{ gap: 4, background: "var(--c-surface)", border: "2px solid var(--c-line-strong)", padding: "0 6px 0 4px" }}
          >
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--w-avatar)", border: "2px solid var(--c-ink)" }} />
            You
          </span>
          <span style={{ width: 2, height: 8, background: "var(--c-line-strong)" }} />
        </div>
      )}
      <div ref={probeRef} aria-hidden="true" className="pointer-events-none absolute" style={{ left: 8, bottom: "calc(var(--stage-inset-bottom, 0px) + 8px)", width: 1, height: 1 }} />
      {scene.towers.length > 0 && (
        <p
          ref={keyRef}
          className="ui-meta pointer-events-none absolute z-10 hidden flex-wrap items-center sm:flex"
          aria-label="Map key: numbered tags are cafés and taller towers are better taste matches; the blue house is your place; the orange dot is you; the black label marks your old regular café, far away."
          style={{
            left: 8,
            bottom: "calc(var(--stage-inset-bottom, 0px) + 36px)",
            maxWidth: "min(520px, calc(100% - 252px))",
            gap: "2px 12px",
            background: "var(--c-surface)",
            color: "var(--c-ink)",
            border: "2px solid var(--c-line-strong)",
            padding: "2px 8px",
          }}
        >
          <span aria-hidden="true">
            <b style={{ border: "2px solid var(--c-line-strong)", padding: "0 4px" }}>1</b> café · taller = better match
          </span>
          <span aria-hidden="true" style={{ color: "var(--w-home)" }}>⌂ your place</span>
          <span aria-hidden="true">
            <i style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: "var(--w-avatar)", border: "2px solid var(--c-ink)" }} /> you
          </span>
          <span aria-hidden="true">◆ old regular</span>
        </p>
      )}
      {labels.map((label) => {
        const open = label.id === selectedId || label.id === hoverId || label.id === focusId;
        if (label.hide) return null;
        if (label.arrow !== undefined) {
          const side = Math.abs(Math.cos((label.arrow * Math.PI) / 180)) > Math.abs(Math.sin((label.arrow * Math.PI) / 180))
            ? Math.cos((label.arrow * Math.PI) / 180) < 0 ? "left" : "right"
            : Math.sin((label.arrow * Math.PI) / 180) < 0 ? "up" : "down";
          return (
            <button
              key={label.id}
              type="button"
              data-edge-arrow
              onClick={() => onSelectRef.current(label.id)}
              aria-label={`${label.n}: ${label.name}, ${Math.round(label.distanceM)} metres, ${side} of the view`}
              className="ui-meta absolute z-10 flex items-center"
              style={{
                left: label.left,
                top: label.top,
                transform: "translate(-50%, -50%)",
                minHeight: 28,
                gap: 4,
                padding: "0 6px",
                background: "var(--c-surface)",
                border: "2px solid var(--c-line-strong)",
                outline: label.id === selectedId ? "2px solid var(--c-accent)" : "none",
                outlineOffset: 2,
                color: "var(--c-ink)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <span aria-hidden="true" style={{ display: "inline-block", transform: `rotate(${Math.round(label.arrow)}deg)` }}>▶</span>
              <b aria-hidden="true">{label.n}</b>
              <span aria-hidden="true">{Math.round(label.distanceM)} m</span>
            </button>
          );
        }
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
