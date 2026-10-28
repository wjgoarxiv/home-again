// The user's own character travelling to a café (walk, taxi or bus) along a Trip from lib/route.
// CONTRACT (round 6): lane `figures` replaces this placeholder with the real meshes; the API below stays.
import * as THREE from "three";
import type { Trip } from "../../lib/route";
import type { WorldPalette } from "./palette";

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

export function createTraveler({ scene, palette }: { scene: THREE.Object3D; palette: WorldPalette }): TravelerHandle {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.16), new THREE.MeshLambertMaterial({ color: palette.avatar }));
  mesh.position.y = 0.15;
  scene.add(mesh);
  let trip: Trip | null = null;
  let t = 0;
  const state: TravelerState = { x: 0, z: 0, heading: 0, done: true };
  const set = (x: number, z: number) => {
    state.x = x;
    state.z = z;
    mesh.position.x = x;
    mesh.position.z = z;
  };
  const at = (k: number) => {
    const pts = trip!.points;
    const a = pts[0];
    const b = pts[pts.length - 1];
    set(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k);
  };
  return {
    place(x, z) {
      trip = null;
      state.done = true;
      set(x, z);
    },
    start(next) {
      trip = next;
      t = 0;
      state.done = false;
      at(0);
    },
    update(dt) {
      if (!trip || state.done) return state;
      t = Math.min(trip.durationSec, t + Math.max(0, dt));
      at(t / trip.durationSec);
      state.done = t >= trip.durationSec;
      return state;
    },
    finish() {
      if (trip) {
        t = trip.durationSec;
        at(1);
      }
      state.done = true;
      return state;
    },
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    },
  };
}
