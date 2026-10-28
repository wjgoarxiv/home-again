"use client";

import { useEffect, useRef, useState } from "react";
import { notFound } from "next/navigation";
import * as THREE from "three";
import { createLife } from "../../../components/world/life";
import { worldPalette } from "../../../components/world/palette";
import { createTraveler } from "../../../components/world/traveler";
import type { Spot, Street } from "../../../lib/life";
import type { P, TravelMode, Trip } from "../../../lib/route";
import { UNIT_M } from "../../../lib/world";

const GRID = [-15, -9, -3, 3, 9, 15];
const STREETS: Street[] = [
  ...GRID.map((z, i): Street => ({ x: -18, z, dir: "x", length: 36, lanes: i % 2 === 0 ? 2 : 1 })),
  ...GRID.map((x, i): Street => ({ x, z: -18, dir: "z", length: 36, lanes: i % 2 === 0 ? 1 : 2 })),
];
const SPOTS: Spot[] = [
  { id: "t1", x: -6, z: -6, height: 6 },
  { id: "t2", x: 6, z: 0, height: 9 },
  { id: "t3", x: 0, z: 6, height: 4 },
];

const CAMERAS = {
  wide: { pos: [34, 34, 34], look: [0, 0, 0] },
  close: { pos: [5.6, 1.9, 6.0], look: [2.6, 0.1, 2.8] },
} as const;

// Road ribbons as in components/world/realTown.ts: 0.55 + 0.2 per lane wide, a 0.15 sidewalk strip each side, tops at 0.03 / 0.015.
const roadW = (lanes: 1 | 2) => 0.55 + 0.2 * lanes;

// The synthetic L-shaped trip: east along z = 3, then north along x = 3.
const TRIP_POINTS: P[] = [
  { x: -5, z: 3 },
  { x: 3, z: 3 },
  { x: 3, z: -5 },
];
const MODES: TravelMode[] = ["walk", "taxi", "bus"];
const TRIP_SECONDS: Record<TravelMode, number> = { walk: 8, taxi: 5, bus: 6 };
const tripOf = (mode: TravelMode): Trip => ({ mode, points: TRIP_POINTS, lengthM: 16 * UNIT_M, durationSec: TRIP_SECONDS[mode] });

function rngOf(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function DevLifePage() {
  if (process.env.NODE_ENV === "production") notFound();
  const containerRef = useRef<HTMLDivElement>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [staticNote, setStaticNote] = useState(false);
  const [close, setClose] = useState(false);
  const [density, setDensity] = useState<0 | 1>(1);
  const [nextMode, setNextMode] = useState<TravelMode>("walk");
  const [stats, setStats] = useState("");
  const closeRef = useRef(close);
  const refitRef = useRef<() => void>(() => {});
  const sendRef = useRef<(mode: TravelMode) => void>(() => {});

  // `?view=close`, `?density=0`, `?trip=walk|taxi|bus` (loops the trip) and `?at=0.4` (freeze it at that progress)
  // open the page in that state, because the interface probe cannot click.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("view") === "close") setClose(true);
    if (q.get("density") === "0") setDensity(0);
  }, []);

  useEffect(() => {
    closeRef.current = close;
    refitRef.current();
  }, [close]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const palette = worldPalette();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
    });

    const root = new THREE.Scene();
    root.background = new THREE.Color(palette.sky);
    root.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(40, 80, 20);
    root.add(key);

    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(44, 1, 44),
      new THREE.MeshLambertMaterial({ color: palette.ground }),
    );
    ground.position.y = -0.5;
    root.add(ground);

    const sidewalkMat = new THREE.MeshLambertMaterial({ color: palette.sidewalk });
    const streetMat = new THREE.MeshLambertMaterial({ color: palette.road });
    const markMat = new THREE.MeshLambertMaterial({ color: palette.marking });
    const ribbon = (st: Street, width: number, top: number, mat: THREE.Material, from = 0, to = st.length) => {
      const len = to - from;
      const geo = st.dir === "x" ? new THREE.BoxGeometry(len, top, width) : new THREE.BoxGeometry(width, top, len);
      const mesh = new THREE.Mesh(geo, mat);
      const mid = from + len / 2;
      mesh.position.set(st.dir === "x" ? st.x + mid : st.x, top / 2, st.dir === "x" ? st.z : st.z + mid);
      root.add(mesh);
    };
    for (const st of STREETS) {
      ribbon(st, roadW(st.lanes) + 0.3, 0.015, sidewalkMat);
      ribbon(st, roadW(st.lanes), 0.03, streetMat);
      if (st.lanes === 2) {
        for (let d = 0.25; d + 0.5 <= st.length - 0.25; d += 1) {
          const dash = st.dir === "x" ? new THREE.BoxGeometry(0.5, 0.045, 0.07) : new THREE.BoxGeometry(0.07, 0.045, 0.5);
          const mesh = new THREE.Mesh(dash, markMat);
          mesh.position.set(st.dir === "x" ? st.x + d + 0.25 : st.x, 0.0225, st.dir === "x" ? st.z : st.z + d + 0.25);
          root.add(mesh);
        }
      }
    }

    // Real-size neighbours: 0.45-0.75 wide and 1.6-7 tall (NYC heights are exaggerated about 2.5x), so cars and people can be judged against them.
    const rng = rngOf(7);
    const lots: { x: number; z: number; w: number; d: number; h: number }[] = [];
    for (let bi = 0; bi < GRID.length - 1; bi++) {
      for (let bj = 0; bj < GRID.length - 1; bj++) {
        const cx = (GRID[bi] + GRID[bi + 1]) / 2;
        const cz = (GRID[bj] + GRID[bj + 1]) / 2;
        for (let i = -2; i <= 2; i++) {
          for (let j = -2; j <= 2; j++) {
            const x = cx + i * 0.85;
            const z = cz + j * 0.85;
            if (SPOTS.some((t) => Math.abs(x - t.x) < 1.6 && Math.abs(z - t.z) < 1.6)) continue;
            if (x > 3.6 && z > 3.6 && x < 8.4 && z < 8.4) continue; // the close-up camera's own block stays open so it can look across it
            if (rng() < 0.18) continue;
            lots.push({ x, z, w: 0.45 + rng() * 0.3, d: 0.45 + rng() * 0.3, h: 1.6 + rng() * rng() * 5.4 });
          }
        }
      }
    }
    const homes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), lots.length);
    const m4 = new THREE.Matrix4();
    const noTurn = new THREE.Quaternion();
    lots.forEach((b, i) => {
      homes.setMatrixAt(i, m4.compose(new THREE.Vector3(b.x, b.h / 2, b.z), noTurn, new THREE.Vector3(b.w, b.h, b.d)));
      homes.setColorAt(i, new THREE.Color(palette.facades[i % palette.facades.length]));
    });
    root.add(homes);

    const capMat = new THREE.MeshLambertMaterial({ color: palette.roofs[0] });
    SPOTS.forEach((spot, si) => {
      const towerMat = new THREE.MeshLambertMaterial({ color: palette.facades[si % palette.facades.length] });
      for (let v = 0; v < spot.height; v++) {
        const vox = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 1.2), v === spot.height - 1 ? capMat : towerMat);
        vox.position.set(spot.x, v + 0.5, spot.z);
        root.add(vox);
      }
    });

    const camera = new THREE.PerspectiveCamera(40, 1, 1, 500);
    const fit = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const cam = CAMERAS[closeRef.current ? "close" : "wide"];
      camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
      camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);
      camera.updateProjectionMatrix();
    };
    fit();
    refitRef.current = () => {
      fit();
      renderer.render(root, camera);
    };

    const life = createLife({ scene: root, streets: STREETS, spots: SPOTS, seed: 20261028, density, palette });
    life.update(0);
    const traveler = createTraveler({ scene: root, palette });
    traveler.place(TRIP_POINTS[0].x, TRIP_POINTS[0].z);
    const q = new URLSearchParams(window.location.search);
    const loopMode = MODES.find((m) => m === q.get("trip")) ?? null;
    const holdAt = q.has("at") ? Math.min(1, Math.max(0, Number(q.get("at")) || 0)) : null;
    let holdUntil = 0;
    let frozen = false;
    const send = (mode: TravelMode) => {
      const trip = tripOf(mode);
      traveler.place(TRIP_POINTS[0].x, TRIP_POINTS[0].z);
      traveler.start(trip);
      if (reduced) traveler.finish();
      else if (holdAt !== null) {
        traveler.update(trip.durationSec * holdAt);
        frozen = true;
      }
      renderer.render(root, camera);
    };
    sendRef.current = send;
    if (loopMode) send(loopMode);
    const meshCount = () => root.children.filter((c) => /^(cars|buses|people|steam|birds|signals|traveler)/.test(c.name)).length;
    renderer.render(root, camera);

    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let meterLast = last;
    let visible = true;
    let stopped = false;

    const tick = (now: number) => {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (!visible || document.visibilityState !== "visible") return;
      life.update(dt);
      if (!frozen) {
        const s = traveler.update(dt);
        if (loopMode && s.done) {
          if (holdUntil === 0) holdUntil = now + 1200;
          else if (now >= holdUntil) {
            holdUntil = 0;
            send(loopMode);
          }
        }
      }
      renderer.render(root, camera);
      frames++;
      if (now - meterLast >= 500) {
        const fpsNow = Math.round((frames * 1000) / (now - meterLast));
        setFps(fpsNow);
        const info = renderer.info.render;
        setStats(`MESHES ${meshCount()} · DRAW CALLS ${info.calls} · TRIANGLES ${info.triangles}`);
        frames = 0;
        meterLast = now;
      }
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      last = performance.now();
    });
    observer.observe(container);
    const onVisibility = () => {
      last = performance.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const onResize = () => fit();
    window.addEventListener("resize", onResize);

    if (reduced) {
      setStaticNote(true);
      setStats(`MESHES ${meshCount()} · DRAW CALLS ${renderer.info.render.calls} · TRIANGLES ${renderer.info.render.triangles}`);
    } else {
      raf = requestAnimationFrame(tick);
    }

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      life.dispose();
      traveler.dispose();
      sendRef.current = () => {};
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const m = mesh.material as THREE.Material | THREE.Material[];
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
      renderer.dispose();
      refitRef.current = () => {};
      if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
    };
  }, [density]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 p-4">
      <header style={{ background: "var(--c-ink)", color: "var(--c-canvas)" }} className="px-4 py-3">
        <p className="ui-meta" style={{ color: "var(--c-canvas)" }}>
          DEV PREVIEW · LIFE LANE
        </p>
        <h1 className="ui-h2">Street life</h1>
      </header>
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden"
        style={{ height: "70vh", minHeight: 420, border: "3px solid var(--c-ink)" }}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="ui-btn ui-btn--sm" aria-pressed={close} onClick={() => setClose((c) => !c)}>
          {close ? "ZOOM OUT" : "CLOSE-UP"}
        </button>
        <button
          type="button"
          className="ui-btn ui-btn--sm"
          aria-pressed={density === 0}
          onClick={() => setDensity((d) => (d === 1 ? 0 : 1))}
        >
          {density === 1 ? "DENSITY 0" : "DENSITY 1"}
        </button>
        <button
          type="button"
          className="ui-btn ui-btn--sm"
          onClick={() => {
            sendRef.current(nextMode);
            setNextMode(MODES[(MODES.indexOf(nextMode) + 1) % MODES.length]);
          }}
        >
          Send traveller ({nextMode})
        </button>
      </div>
      <p
        className="ui-meta"
        style={{ background: "var(--c-surface)", border: "2px solid var(--c-line-strong)", padding: "8px 12px" }}
      >
        <span className="block">
          SYNTHETIC DATA ONLY · NO NETWORK · {staticNote ? "STATIC (PREFERS-REDUCED-MOTION)" : `FPS ${fps ?? "…"}`}
        </span>
        <span className="block">
          STREETS {STREETS.length} · TOWERS {SPOTS.length}
        </span>
        <span className="block">
          DENSITY {density} · {close ? "CLOSE-UP" : "WIDE"} · TRAVELLER NEXT {nextMode.toUpperCase()}
        </span>
        <span className="block">{stats}</span>
      </p>
    </main>
  );
}
