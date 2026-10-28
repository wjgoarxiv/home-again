"use client";

import { useEffect, useRef, useState } from "react";
import { notFound } from "next/navigation";
import * as THREE from "three";
import { createLife } from "../../../components/world/life";
import type { Spot, Street } from "../../../lib/life";

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

function readPalette() {
  const css = (name: string, fallback: string) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    car: [css("--c-accent", "#c8370c"), css("--c-accent-2", "#1559b8"), "#5a5e5a"],
    person: [css("--c-ink-2", "#2f322f"), "#6b6e6a", css("--c-support", "#cfe6c7")],
    steam: "#ffffff",
    bird: css("--c-ink-2", "#2f322f"),
  };
}

export default function DevLifePage() {
  if (process.env.NODE_ENV === "production") notFound();
  const containerRef = useRef<HTMLDivElement>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [staticNote, setStaticNote] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const palette = readPalette();
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
    root.background = new THREE.Color(palette.person[2] ?? "#cfe6c7");
    root.add(new THREE.AmbientLight(0xffffff, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(40, 80, 20);
    root.add(key);

    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(44, 1, 44),
      new THREE.MeshLambertMaterial({ color: "#f4f4f1" }),
    );
    ground.position.y = -0.5;
    root.add(ground);

    const streetMat = new THREE.MeshLambertMaterial({ color: "#dadbd6" });
    for (const st of STREETS) {
      const geo =
        st.dir === "x" ? new THREE.BoxGeometry(st.length, 0.12, 1.6) : new THREE.BoxGeometry(1.6, 0.12, st.length);
      const mesh = new THREE.Mesh(geo, streetMat);
      mesh.position.set(st.dir === "x" ? st.x + st.length / 2 : st.x, 0.06, st.dir === "x" ? st.z : st.z + st.length / 2);
      root.add(mesh);
    }

    const towerMat = new THREE.MeshLambertMaterial({ color: "#2f322f" });
    const capMat = new THREE.MeshLambertMaterial({ color: palette.car[0] });
    for (const spot of SPOTS) {
      for (let v = 0; v < spot.height; v++) {
        const vox = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1, 1.8), v === spot.height - 1 ? capMat : towerMat);
        vox.position.set(spot.x, v + 0.5, spot.z);
        root.add(vox);
      }
    }

    const camera = new THREE.PerspectiveCamera(40, 1, 1, 500);
    const fit = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.position.set(34, 34, 34);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    };
    fit();

    const life = createLife({ scene: root, streets: STREETS, spots: SPOTS, seed: 20261028, density: 1, palette });
    life.update(0);
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
      renderer.render(root, camera);
      frames++;
      if (now - meterLast >= 500) {
        setFps(Math.round((frames * 1000) / (now - meterLast)));
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
      if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement);
    };
  }, []);

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
      <p
        className="ui-meta"
        style={{ background: "var(--c-surface)", border: "2px solid var(--c-line-strong)", padding: "8px 12px" }}
      >
        SYNTHETIC DATA ONLY · NO NETWORK · {staticNote ? "STATIC (PREFERS-REDUCED-MOTION)" : `FPS ${fps ?? "…"}`} ·
        STREETS {STREETS.length} · TOWERS {SPOTS.length} · DENSITY 1
      </p>
    </main>
  );
}
