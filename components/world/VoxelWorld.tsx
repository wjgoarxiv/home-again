"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { compactLabel, fitScene } from "../../lib/world";
import type { Scene, Tower } from "../../lib/world";
import { buildTown, planTown, seedFromString, type TownCafe, type TownPalette } from "./town";
import { createLife, type LifeHandle } from "./life";
import type { Street } from "../../lib/life";

export type VoxelWorldProps = {
  scene: Scene;
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  onReady?: () => void;
};

type Palette = {
  accent: string;
  accent2: string;
  support: string;
  supportInk: string;
  ink2: string;
  line: string;
  lineStrong: string;
  accentWash: string;
  surface: string;
  sunken: string;
};

type Label = { id: string; n: number; name: string; distanceM: number; left: number; top: number };

const VOX = 1.8;
const VOX_H = 1;
const GREY = "#8b8e89";
const LOT_Y = 0.22;

function readPalette(): Palette {
  const css = (name: string, fallback: string) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  };
  return {
    accent: css("--c-accent", "#c8370c"),
    accent2: css("--c-accent-2", "#1559b8"),
    support: css("--c-support", "#cfe6c7"),
    supportInk: css("--c-support-ink", "#1d4a17"),
    ink2: css("--c-ink-2", "#2f322f"),
    line: css("--c-line", "#c3c5bf"),
    lineStrong: css("--c-line-strong", "#3a3d3a"),
    accentWash: css("--c-accent-wash", "#f3dccf"),
    surface: css("--c-surface", "#f4f4f1"),
    sunken: css("--c-sunken", "#dadbd6"),
  };
}

function townPalette(p: Palette): TownPalette {
  return {
    base: p.sunken,
    road: "#262926",
    marking: "#e6e7e0",
    cross: "#d8d9d2",
    side: p.surface,
    grass: p.support,
    path: p.ink2,
    wallA: p.surface,
    wallB: p.lineStrong,
    brick: p.accentWash,
    roof: p.line,
    detail: p.line,
    store: p.support,
    windowDark: "#161a15",
    windowLitA: p.accent2,
    windowLitB: p.accent,
    trunk: "#4a3f33",
    canopy: p.supportInk,
    pole: p.line,
    lampHead: p.accent2,
    bench: p.line,
    signalA: "#b0131a",
    signalB: "#1d6b2c",
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
  if (tower.status === "rejected") return { count: 1, colors: [GREY], marker: false };
  const count =
    tower.status === "crowded" ? Math.max(1, Math.floor(tower.height / 2)) : tower.height;
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    if (tower.status === "loved" || tower.status === "revisit") colors.push(palette.accent);
    else if (tower.status === "crowded") colors.push(GREY);
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

export default function VoxelWorld({ scene, selectedId, onSelect, loading, onReady }: VoxelWorldProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
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
  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer;
    camera: THREE.OrthographicCamera;
    root: THREE.Scene;
    content: THREE.Group | null;
    scan: THREE.InstancedMesh | null;
    tops: Map<string, number>;
    bases: Map<string, number>;
    target: THREE.Vector3;
    reduced: boolean;
    scanAngle: number;
    scanTimer: number | null;
    stepTimers: number[];
    prevCounts: Map<string, number>;
    palette: Palette;
    pointers: Map<number, { x: number; y: number }>;
    pinchDist: number | null;
    fitHalf: number;
    fitKey: string;
    lastFocus: string | null;
    applyFit: () => void;
    renderNow: () => void;
    life: LifeHandle | null;
    lifeRaf: number;
    lastT: number;
    labelKey: string;
    visible: boolean;
    densityBucket: number;
    streets: Street[];
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const palette = readPalette();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setClearColor(new THREE.Color(palette.sunken));
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
    root.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(60, 120, 20);
    root.add(key);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600);
    const target = new THREE.Vector3(0, 0, 0);
    const st = {
      renderer,
      camera,
      root,
      content: null as THREE.Group | null,
      scan: null as THREE.InstancedMesh | null,
      tops: new Map<string, number>(),
      bases: new Map<string, number>(),
      target,
      reduced,
      scanAngle: 0,
      scanTimer: null as number | null,
      stepTimers: [] as number[],
      prevCounts: new Map<string, number>(),
      palette,
      pointers: new Map<number, { x: number; y: number }>(),
      pinchDist: null as number | null,
      fitHalf: 46,
      fitKey: "",
      lastFocus: null,
      applyFit: () => {},
      renderNow: () => {},
      life: null as LifeHandle | null,
      lifeRaf: 0,
      lastT: 0,
      labelKey: "",
      visible: true,
      densityBucket: -1,
      streets: [],
    };
    threeRef.current = st;

    const fit = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w < 640 ? 1.5 : 2));
      renderer.setSize(w, h, false);
      const aspect = Math.max(w / h, 0.2);
      const viewSize = (2 * st.fitHalf) / aspect;
      const halfH = viewSize / 2;
      camera.left = -halfH * aspect;
      camera.right = halfH * aspect;
      camera.top = halfH;
      camera.bottom = -halfH;
      camera.updateProjectionMatrix();
    };
    st.applyFit = fit;
    fit();

    const render = () => {
      const iso = new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(240);
      camera.position.copy(st.target).add(iso);
      camera.lookAt(st.target);
      camera.updateProjectionMatrix();
      renderer.render(root, camera);
      container.dataset.draws = String(renderer.info.render.calls);
      updateLabels();
    };

    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(hi, v));
    const updateLabels = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      const current = sceneRef.current;
      const v = new THREE.Vector3();
      const next: Label[] = current.towers.map((t, i) => {
        const top = st.tops.get(t.id) ?? VOX_H * t.height;
        v.set(t.x, top + 0.4, t.z).project(camera);
        return {
          id: t.id,
          n: i + 1,
          name: t.name,
          distanceM: t.distanceM,
          left: clamp((v.x * 0.5 + 0.5) * w, 24, w - 24),
          top: clamp((-v.y * 0.5 + 0.5) * h, 24, h - 24),
        };
      });
      v.set(current.home.x, 7, current.home.z).project(camera);
      const hx = (v.x * 0.5 + 0.5) * w;
      const hy = (-v.y * 0.5 + 0.5) * h;
      const docked = hx < 0 || hx > w || hy < 0 || hy > h;
      const key =
        next.map((l) => `${l.id}:${Math.round(l.left)}:${Math.round(l.top)}`).join("|") +
        `#${Math.round(hx)}:${Math.round(hy)}`;
      if (key === st.labelKey) return;
      st.labelKey = key;
      setLabels(next);
      setHomeLabel(
        docked
          ? {
              ...(hx <= w / 2 ? { left: 8 } : { right: 8 }),
              ...(hy <= h / 2 ? { top: 8 } : { bottom: 8 }),
              docked: true,
            }
          : {
              left: clamp(hx, 110, w - 110),
              top: clamp(hy, 40, h - 20),
              transform: "translate(-50%, -130%)",
              docked: false,
            },
      );
    };
    (st as { render?: () => void }).render = render;
    (st as { updateLabels?: () => void }).updateLabels = updateLabels;

    const renderNow = () => (threeRef.current as unknown as { render: () => void }).render();
    st.renderNow = renderNow;

    const densityOf = () => (container.clientWidth || 1) >= 1024 ? 1 : 0.5;
    const stopLoop = () => {
      if (st.lifeRaf) {
        cancelAnimationFrame(st.lifeRaf);
        st.lifeRaf = 0;
      }
    };
    const setupLife = () => {
      if (st.reduced) return;
      const bucket = densityOf();
      if (st.life && bucket === st.densityBucket) return;
      if (st.life) {
        st.life.dispose();
        st.life = null;
      }
      stopLoop();
      st.densityBucket = bucket;
      if (!threeRef.current) return;
      const current = sceneRef.current;
      st.life = createLife({
        scene: root,
        streets: st.streets,
        spots: current.towers.map((t) => ({ id: t.id, x: t.x, z: t.z, height: t.height })),
        seed: seedFromString(current.home.label),
        density: bucket,
        palette: {
          car: [palette.accent, palette.accent2, "#5a5e5a"],
          person: [palette.ink2, "#6b6e6a", palette.support],
          steam: "#ffffff",
          bird: palette.ink2,
        },
      });
      if (st.visible && !document.hidden) startLoop();
    };
    const startLoop = () => {
      if (st.reduced || !st.life || st.lifeRaf || !st.visible || document.hidden) return;
      st.lastT = performance.now();
      let frames = 0;
      let ema = 60;
      const loop = (now: number) => {
        if (!threeRef.current || !st.life) {
          st.lifeRaf = 0;
          return;
        }
        st.lifeRaf = requestAnimationFrame(loop);
        const dt = Math.min((now - st.lastT) / 1000, 0.1);
        st.lastT = now;
        if (dt > 0) ema = ema * 0.95 + (1 / dt) * 0.05;
        frames++;
        if (frames % 60 === 0) container.dataset.fps = String(Math.round(ema));
        st.life.update(dt);
        render();
      };
      st.lifeRaf = requestAnimationFrame(loop);
    };
    (st as { setupLife?: () => void }).setupLife = () => void setupLife();

    const onPointerDown = (e: PointerEvent) => {
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
          camera.zoom = Math.min(2.6, Math.max(0.55, camera.zoom * (dist / st.pinchDist)));
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
      st.target.x = Math.min(st.fitHalf, Math.max(-st.fitHalf, st.target.x));
      st.target.z = Math.min(st.fitHalf, Math.max(-st.fitHalf, st.target.z));
      renderNow();
    };
    const onPointerUp = (e: PointerEvent) => {
      st.pointers.delete(e.pointerId);
      st.pinchDist = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camera.zoom = Math.min(2.6, Math.max(0.55, camera.zoom * Math.exp(-e.deltaY * 0.001)));
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
        if (stNow.scanTimer !== null) window.clearInterval(stNow.scanTimer);
        stNow.stepTimers.forEach((t) => window.clearTimeout(t));
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

  useEffect(() => {
    const st = threeRef.current;
    if (!st) return;
    const renderNow = () => (threeRef.current as unknown as { render: () => void }).render();
    const { palette } = st;

    const fit = fitScene(scene);
    const fitKey = fit.halfSize.toFixed(2);
    if (fitKey !== st.fitKey) {
      st.fitKey = fitKey;
      st.fitHalf = fit.halfSize;
      st.camera.zoom = 1;
      st.target.set(0, 0, 0);
      st.applyFit();
    }

    const focusId = scene.focusId ?? null;
    const focusTower = focusId ? scene.towers.find((t) => t.id === focusId) ?? null : null;
    if (focusId !== st.lastFocus) {
      st.lastFocus = focusId;
      if (focusTower) {
        const dest = new THREE.Vector3(focusTower.x, 0, focusTower.z);
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
    if (st.scanTimer !== null) {
      window.clearInterval(st.scanTimer);
      st.scanTimer = null;
    }
    st.stepTimers.forEach((t) => window.clearTimeout(t));
    st.stepTimers = [];
    st.scan = null;

    const content = new THREE.Group();
    st.content = content;
    st.tops = new Map();
    st.bases = new Map();

    const cafes: TownCafe[] = scene.towers.map((t) => {
      const count = towerVoxels(t, palette).count;
      return {
        x: t.x,
        z: t.z,
        clear: count <= 3 ? 7.5 : count <= 5 ? 6 : 4.5,
        cap: Math.min(6, Math.max(2, count)),
      };
    });
    const townPlan = planTown({
      seed: seedFromString(scene.home.label),
      half: 90,
      cafes,
      ringRadii: scene.rings.map((r) => r.radiusUnits),
    });
    st.streets = townPlan.streets;
    content.add(buildTown(townPlan, townPalette(palette), cafes).group);

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
          counts.set(id, Math.round(a + ((spec.count - a) * step) / 3));
        }
        paintTowers(counts);
        renderNow();
        if (step < 3) {
          st.stepTimers.push(window.setTimeout(tick, 100));
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

    const currentRing = scene.rings.find((r) => r.current) ?? scene.rings[0];
    for (const ring of scene.rings) {
      const count = Math.max(24, Math.floor((2 * Math.PI * ring.radiusUnits) / 2.2));
      const mesh = boxMesh(count, ring.current ? palette.accent : palette.line);
      mesh.userData.layer = "rings";
      let i = 0;
      for (let s = 0; s < count; s++) {
        if (s % 3 === 2) continue;
        const a = (s / count) * Math.PI * 2;
        place(
          mesh, i,
          Math.cos(a) * ring.radiusUnits, 1.15, Math.sin(a) * ring.radiusUnits,
          1.2, 0.25, 1.2,
          ring.current ? palette.accent : palette.line,
        );
        i++;
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      content.add(mesh);
    }

    if (currentRing && loading && !st.reduced) {
      const scan = boxMesh(7, palette.accent2);
      scan.userData.layer = "scan";
      st.scan = scan;
      content.add(scan);
      const drawScan = () => {
        if (!st.scan) return;
        for (let s = 0; s < 7; s++) {
          const a = st.scanAngle + ((s - 3) * 2.4 * Math.PI) / 180;
          place(
            st.scan, s,
            Math.cos(a) * currentRing.radiusUnits, 1.15, Math.sin(a) * currentRing.radiusUnits,
            1.7, 0.35, 1.7,
            palette.accent2,
          );
        }
        st.scan.instanceMatrix.needsUpdate = true;
        if (st.scan.instanceColor) st.scan.instanceColor.needsUpdate = true;
        st.scanAngle += (14 * Math.PI) / 180;
        renderNow();
      };
      drawScan();
      st.scanTimer = window.setInterval(drawScan, 140);
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

    st.root.add(content);
    if (st.life) {
      st.life.setSpots(scene.towers.map((t) => ({ id: t.id, x: t.x, z: t.z, height: t.height })));
    }
    renderNow();
    onReadyRef.current?.();
    ((st as unknown as { setupLife?: () => void }).setupLife ?? (() => {}))();
  }, [scene, loading]);

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
        const open = label.id === selectedId || label.id === hoverId || label.id === scene.focusId;
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
