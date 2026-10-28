// The user's own character travelling to a café (walk, taxi or bus) along a Trip from lib/route.
// Three meshes: the figure (six boxes), the vehicle (taxi or bus parts) and a diamond marker above whichever is showing.
import * as THREE from "three";
import type { P, Trip } from "../../lib/route";
import {
  BUS_PARTS,
  FIGURE_HEIGHT,
  FIGURE_PARTS,
  TAXI_PARTS,
  VEHICLE_Y,
  WALK_Y,
  disposeMesh,
  makeMesh,
  paintFigure,
  poseFigure,
  roleColor,
  type VehiclePart,
} from "./life";
import { FALLBACK_PALETTE, type WorldPalette } from "./palette";

/** heading is the direction of travel in the x-z plane, atan2(dz, dx): 0 faces +x (east), PI/2 faces +z (south). */
export type TravelerState = { x: number; z: number; heading: number; done: boolean };

export type TravelerHandle = {
  /** Places the character at rest (e.g. at home or at the last café). */
  place(x: number, z: number): void;
  /** Starts a trip; the character rides or walks along trip.points over trip.durationSec. */
  start(trip: Trip): void;
  /** Advances the trip; returns the current state, done=true once at the last point. */
  update(dtSec: number): TravelerState;
  /** Jumps to the end of the current trip (reduced motion). */
  finish(): TravelerState;
  dispose(): void;
};

export type PathPoint = { x: number; z: number; heading: number };

/**
 * Position and heading a fraction `k` (0..1, by length) along a polyline, so equal steps in k are equal distances.
 * Repeated points are skipped; an empty or zero-length path gives its first point (or the origin) with heading 0.
 * Pass `out` to reuse an object across frames.
 */
export function pointAlong(points: readonly P[], k: number, out: PathPoint = { x: 0, z: 0, heading: 0 }): PathPoint {
  out.x = 0;
  out.z = 0;
  out.heading = 0;
  if (points.length === 0) return out;
  out.x = points[0].x;
  out.z = points[0].z;
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  if (!(total > 0)) return out;
  const target = (Number.isFinite(k) ? Math.min(1, Math.max(0, k)) : 0) * total;
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len === 0) continue;
    out.heading = Math.atan2(b.z - a.z, b.x - a.x);
    if (target <= walked + len) {
      const f = (target - walked) / len;
      out.x = a.x + (b.x - a.x) * f;
      out.z = a.z + (b.z - a.z) * f;
      return out;
    }
    walked += len;
  }
  const last = points[points.length - 1];
  out.x = last.x;
  out.z = last.z;
  return out;
}

const TRAVELER_HEIGHT = 0.26;
const FIGURE_SCALE = TRAVELER_HEIGHT / FIGURE_HEIGHT;
/** The taxi is drawn a quarter larger than an ordinary car so the user's ride is easy to follow. */
const TAXI_SCALE = 1.25;
/** Trips last 3 to 8 s whatever their length, so a walking character runs a fixed 3 strides per second. */
const WALK_CADENCE = 3;
const WALK_SWING = 0.7;
/** Radians per second the drawn heading turns toward the street direction at a corner. */
const TURN_RATE = 14;
const MARKER_GAP = 0.05;
const MARKER_SIZE = { x: 0.04, y: 0.07, z: 0.04 };
const TAU = Math.PI * 2;

type Ride = "walk" | "taxi" | "bus" | null;

export function createTraveler({ scene, palette }: { scene: THREE.Object3D; palette: WorldPalette }): TravelerHandle {
  const figure = makeMesh("traveler:figure", FIGURE_PARTS, "#ffffff");
  paintFigure(
    figure,
    0,
    palette.skin[0] ?? FALLBACK_PALETTE.skin[0],
    palette.avatar,
    palette.pants[0] ?? FALLBACK_PALETTE.pants[0],
    false,
  );
  if (figure.instanceColor) figure.instanceColor.needsUpdate = true;
  const vehicle = makeMesh("traveler:vehicle", Math.max(TAXI_PARTS.length, BUS_PARTS.length), "#ffffff");
  vehicle.visible = false;
  const marker = new THREE.Mesh(
    new THREE.OctahedronGeometry(1),
    new THREE.MeshLambertMaterial({ color: palette.avatar, flatShading: true }),
  );
  marker.name = "traveler:marker";
  marker.scale.set(MARKER_SIZE.x, MARKER_SIZE.y, MARKER_SIZE.z);
  marker.frustumCulled = false;
  scene.add(figure, vehicle, marker);

  const tint = new THREE.Color();
  const paintVehicle = (parts: VehiclePart[], body: string) => {
    parts.forEach((q, i) => vehicle.setColorAt(i, q.role === "body" ? tint.set(body) : roleColor(q.role, palette, tint)));
    if (vehicle.instanceColor) vehicle.instanceColor.needsUpdate = true;
    vehicle.count = parts.length;
  };
  const top = (parts: VehiclePart[], scale: number) => VEHICLE_Y + Math.max(...parts.map((q) => q.oy + q.sy / 2)) * scale;
  const tops = { taxi: top(TAXI_PARTS, TAXI_SCALE), bus: top(BUS_PARTS, 1) };

  const yAxis = new THREE.Vector3(0, 1, 0);
  const yaw = new THREE.Quaternion();
  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const cur: PathPoint = { x: 0, z: 0, heading: 0 };
  const state: TravelerState = { x: 0, z: 0, heading: 0, done: true };

  let trip: Trip | null = null;
  let ride: Ride = null;
  let t = 0;
  let drawnHeading = 0;
  let disposed = false;

  const draw = () => {
    yaw.setFromAxisAngle(yAxis, -drawnHeading);
    if (ride === "taxi" || ride === "bus") {
      const parts = ride === "taxi" ? TAXI_PARTS : BUS_PARTS;
      const sc = ride === "taxi" ? TAXI_SCALE : 1;
      const hx = Math.cos(drawnHeading);
      const hz = Math.sin(drawnHeading);
      for (let i = 0; i < parts.length; i++) {
        const q = parts[i];
        pos.set(state.x + (q.ox * hx - q.oz * hz) * sc, VEHICLE_Y + q.oy * sc, state.z + (q.ox * hz + q.oz * hx) * sc);
        scl.set(q.sx * sc, q.sy * sc, q.sz * sc);
        vehicle.setMatrixAt(i, mat.compose(pos, yaw, scl));
      }
      vehicle.instanceMatrix.needsUpdate = true;
      vehicle.visible = true;
      figure.visible = false;
      marker.position.set(state.x, tops[ride] + MARKER_GAP + MARKER_SIZE.y, state.z);
    } else {
      const swing = ride === "walk" ? Math.sin(t * TAU * WALK_CADENCE) * WALK_SWING : 0;
      poseFigure(figure, 0, state.x, WALK_Y, state.z, yaw, swing, FIGURE_SCALE);
      figure.instanceMatrix.needsUpdate = true;
      figure.visible = true;
      vehicle.visible = false;
      marker.position.set(state.x, WALK_Y + TRAVELER_HEIGHT + MARKER_GAP + MARKER_SIZE.y, state.z);
    }
  };

  /** Moves the state to progress k of the trip and turns the drawn heading toward it. */
  const advance = (k: number, dt: number) => {
    pointAlong(trip!.points, k, cur);
    state.x = cur.x;
    state.z = cur.z;
    state.heading = cur.heading;
    const diff = cur.heading - drawnHeading;
    const wrapped = diff - TAU * Math.round(diff / TAU);
    const step = TURN_RATE * dt;
    drawnHeading += Math.abs(wrapped) <= step ? wrapped : Math.sign(wrapped) * step;
    if (k >= 1) {
      state.done = true;
      ride = null;
      drawnHeading = cur.heading;
    }
    draw();
  };

  const standAt = (x: number, z: number) => {
    trip = null;
    ride = null;
    state.done = true;
    state.x = x;
    state.z = z;
    drawnHeading = state.heading;
    draw();
  };
  standAt(0, 0);

  return {
    place(x, z) {
      if (disposed) return;
      standAt(x, z);
    },
    start(next) {
      if (disposed) return;
      trip = next;
      t = 0;
      ride = next.mode;
      state.done = false;
      if (ride !== "walk") paintVehicle(ride === "taxi" ? TAXI_PARTS : BUS_PARTS, ride === "taxi" ? palette.taxi : palette.bus);
      drawnHeading = pointAlong(next.points, 0, cur).heading;
      advance(0, 0);
    },
    update(dt) {
      if (disposed || !trip || state.done) return state;
      const d = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      t = Math.min(trip.durationSec, t + d);
      advance(trip.durationSec > 0 ? t / trip.durationSec : 1, d);
      return state;
    },
    finish() {
      if (disposed || !trip) {
        state.done = true;
        return state;
      }
      t = trip.durationSec;
      advance(1, 0);
      return state;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const m of [figure, vehicle, marker]) disposeMesh(m);
    },
  };
}
