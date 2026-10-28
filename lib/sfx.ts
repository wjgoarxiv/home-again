// Tiny WebAudio cues for the guided tour: one oscillator and one gain envelope per note, no audio files.
// The AudioContext is created only inside `unlock()`, which the caller runs from a user gesture.

export type Cue = "tick" | "love" | "crowded" | "reject" | "regular";

type Note = {
  /** Start frequency in Hz. */
  freq: number;
  /** Frequency the note slides to by its end, if it moves. */
  endFreq?: number;
  /** Seconds after the cue starts. */
  at: number;
  /** Seconds the note sounds. */
  dur: number;
  type: "sine" | "square" | "triangle";
};

export const CUES: Record<Cue, Note[]> = {
  tick: [{ freq: 1760, at: 0, dur: 0.05, type: "square" }],
  love: [
    { freq: 523.25, at: 0, dur: 0.12, type: "triangle" },
    { freq: 783.99, at: 0.11, dur: 0.2, type: "triangle" },
  ],
  crowded: [{ freq: 110, endFreq: 82, at: 0, dur: 0.22, type: "sine" }],
  reject: [{ freq: 440, endFreq: 220, at: 0, dur: 0.14, type: "square" }],
  regular: [
    { freq: 523.25, at: 0, dur: 0.16, type: "triangle" },
    { freq: 659.25, at: 0.15, dur: 0.16, type: "triangle" },
    { freq: 783.99, at: 0.3, dur: 0.45, type: "triangle" },
  ],
};

export const MASTER_GAIN = 0.15;
export const MUTE_KEY = "home-again.sfx.muted";

type Param = {
  value: number;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
  exponentialRampToValueAtTime(v: number, t: number): unknown;
};
type Node = { connect(to: unknown): unknown };

/** The slice of AudioContext the cues use, so tests can stub it. */
export type AudioContextLike = {
  currentTime: number;
  state: string;
  destination: unknown;
  resume(): Promise<void>;
  createOscillator(): Node & {
    type: string;
    frequency: Param;
    start(t: number): void;
    stop(t: number): void;
  };
  createGain(): Node & { gain: Param };
};

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export type SfxDeps = {
  createContext: () => AudioContextLike;
  storage: StorageLike | null;
  prefersReducedMotion: () => boolean;
};

export type Sfx = {
  /** Create (once) and resume the AudioContext. Call from a click or key handler. */
  unlock(): void;
  play(cue: Cue): void;
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  toggle(): boolean;
};

export function createSfx(deps: SfxDeps): Sfx {
  let ctx: AudioContextLike | null = null;
  let master: (Node & { gain: Param }) | null = null;
  let muted: boolean | null = null;

  function readMuted(): boolean {
    if (muted !== null) return muted;
    let stored: string | null = null;
    try {
      stored = deps.storage?.getItem(MUTE_KEY) ?? null;
    } catch {
      stored = null;
    }
    muted = stored === "1" ? true : stored === "0" ? false : deps.prefersReducedMotion();
    return muted;
  }

  function unlock() {
    if (!ctx) {
      try {
        const made = deps.createContext();
        const out = made.createGain();
        out.gain.value = MASTER_GAIN;
        out.connect(made.destination);
        ctx = made;
        master = out;
      } catch {
        return;
      }
    }
    try {
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    } catch {
      // a context that cannot resume simply stays silent
    }
  }

  function play(cue: Cue) {
    if (!ctx || !master || readMuted()) return;
    const t0 = ctx.currentTime;
    for (const n of CUES[cue]) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const start = t0 + n.at;
      const end = start + n.dur;
      osc.type = n.type;
      osc.frequency.setValueAtTime(n.freq, start);
      if (n.endFreq) osc.frequency.exponentialRampToValueAtTime(n.endFreq, end);
      env.gain.setValueAtTime(0.0001, start);
      env.gain.linearRampToValueAtTime(1, start + Math.min(0.01, n.dur / 4));
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(env);
      env.connect(master);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  }

  function setMuted(next: boolean) {
    muted = next;
    try {
      deps.storage?.setItem(MUTE_KEY, next ? "1" : "0");
    } catch {
      // private mode or blocked storage: the choice lasts for this page only
    }
  }

  return {
    unlock,
    play,
    isMuted: readMuted,
    setMuted,
    toggle() {
      setMuted(!readMuted());
      return readMuted();
    },
  };
}

/** The app's shared instance, wired to the browser. Safe to import on the server: nothing runs until `unlock()`. */
export const sfx: Sfx = createSfx({
  createContext: () => {
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as unknown as new () => AudioContextLike;
    return new Ctor();
  },
  get storage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  },
  prefersReducedMotion: () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
});
