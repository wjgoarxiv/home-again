import { describe, expect, it, vi } from "vitest";
import { CUES, MASTER_GAIN, MUTE_KEY, createSfx, type AudioContextLike } from "./sfx";

type Osc = { type: string; frequency: { setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };

function stubContext() {
  const oscillators: Osc[] = [];
  const gains: { gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn> }[] = [];
  const ctx = {
    currentTime: 1,
    state: "suspended",
    destination: {},
    resume: vi.fn(async () => {}),
    createOscillator: vi.fn(() => {
      const o: Osc = {
        type: "sine",
        frequency: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(o);
      return o;
    }),
    createGain: vi.fn(() => {
      const g = { gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
      gains.push(g);
      return g;
    }),
  };
  return { ctx: ctx as unknown as AudioContextLike, raw: ctx, oscillators, gains };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    data,
  };
}

function make(opts: { reduced?: boolean; stored?: Record<string, string> } = {}) {
  const stub = stubContext();
  const create = vi.fn(() => stub.ctx);
  const storage = memoryStorage(opts.stored);
  const sfx = createSfx({ createContext: create, storage, prefersReducedMotion: () => opts.reduced ?? false });
  return { sfx, create, storage, ...stub };
}

describe("cue table", () => {
  it("has the five cues from the brief", () => {
    expect(Object.keys(CUES).sort()).toEqual(["crowded", "love", "regular", "reject", "tick"]);
  });
  it("love rises across two notes, regular is a three-note fanfare, reject falls, crowded is low", () => {
    expect(CUES.love).toHaveLength(2);
    expect(CUES.love[1].freq).toBeGreaterThan(CUES.love[0].freq);
    expect(CUES.regular).toHaveLength(3);
    expect(CUES.regular[2].freq).toBeGreaterThan(CUES.regular[0].freq);
    expect(CUES.reject[0].endFreq ?? CUES.reject[0].freq).toBeLessThan(CUES.reject[0].freq);
    expect(CUES.crowded[0].freq).toBeLessThan(200);
    expect(CUES.tick[0].freq).toBeGreaterThan(CUES.crowded[0].freq);
    expect(CUES.tick[0].dur).toBeLessThan(0.1);
  });
  it("keeps the master gain near 0.15", () => {
    expect(MASTER_GAIN).toBeCloseTo(0.15, 2);
  });
});

describe("createSfx", () => {
  it("creates no AudioContext until unlock is called from a gesture", () => {
    const { sfx, create } = make();
    sfx.play("tick");
    expect(create).not.toHaveBeenCalled();
    sfx.unlock();
    expect(create).toHaveBeenCalledTimes(1);
    sfx.unlock();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("resumes a suspended context on unlock", () => {
    const { sfx, raw } = make();
    sfx.unlock();
    expect(raw.resume).toHaveBeenCalled();
  });

  it("routes a master gain of about 0.15 to the destination", () => {
    const { sfx, gains } = make();
    sfx.unlock();
    expect(gains[0].gain.value).toBeCloseTo(0.15, 2);
    expect(gains[0].connect).toHaveBeenCalled();
  });

  it("plays one oscillator per note with a gain envelope", () => {
    const { sfx, oscillators } = make();
    sfx.unlock();
    sfx.play("regular");
    expect(oscillators).toHaveLength(3);
    for (const o of oscillators) {
      expect(o.start).toHaveBeenCalled();
      expect(o.stop).toHaveBeenCalled();
    }
    sfx.play("love");
    expect(oscillators).toHaveLength(5);
  });

  it("slides a falling cue down to its end frequency", () => {
    const { sfx, oscillators } = make();
    sfx.unlock();
    sfx.play("reject");
    expect(oscillators[0].frequency.exponentialRampToValueAtTime).toHaveBeenCalled();
  });

  it("is silent while muted and before unlock", () => {
    const { sfx, oscillators } = make();
    sfx.play("tick");
    sfx.unlock();
    sfx.setMuted(true);
    sfx.play("tick");
    expect(oscillators).toHaveLength(0);
    sfx.setMuted(false);
    sfx.play("tick");
    expect(oscillators).toHaveLength(1);
  });

  it("defaults to sound on, and muted under reduced motion", () => {
    expect(make().sfx.isMuted()).toBe(false);
    expect(make({ reduced: true }).sfx.isMuted()).toBe(true);
  });

  it("persists the mute choice and prefers it over the reduced-motion default", () => {
    const a = make({ reduced: true });
    a.sfx.setMuted(false);
    expect(a.storage.data[MUTE_KEY]).toBe("0");
    expect(make({ reduced: true, stored: { [MUTE_KEY]: "0" } }).sfx.isMuted()).toBe(false);
    expect(make({ stored: { [MUTE_KEY]: "1" } }).sfx.isMuted()).toBe(true);
  });

  it("survives storage that throws", () => {
    const stub = stubContext();
    const boom = () => {
      throw new Error("blocked");
    };
    const sfx = createSfx({ createContext: () => stub.ctx, storage: { getItem: boom, setItem: boom }, prefersReducedMotion: () => false });
    expect(() => sfx.setMuted(true)).not.toThrow();
    expect(sfx.isMuted()).toBe(true);
  });

  it("survives an AudioContext that cannot be created", () => {
    const sfx = createSfx({
      createContext: () => {
        throw new Error("no audio");
      },
      storage: memoryStorage(),
      prefersReducedMotion: () => false,
    });
    expect(() => {
      sfx.unlock();
      sfx.play("tick");
    }).not.toThrow();
  });

  it("toggle flips the mute state and returns it", () => {
    const { sfx } = make();
    expect(sfx.toggle()).toBe(true);
    expect(sfx.toggle()).toBe(false);
  });
});
