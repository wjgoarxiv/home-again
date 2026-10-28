import "server-only";
import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";

export interface Store {
  readonly kind: "memory" | "upstash";
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSec: number): Promise<void>;
  incr(key: string, ttlSec: number): Promise<number>;
}

export type Caps = { session: number; daily: number };

export class LimitError extends Error {
  constructor(readonly scope: "session" | "daily") {
    super(scope === "session" ? "This demo session has used its Qloo lookups." : "The demo has reached today's Qloo limit.");
  }
}

const CACHE_TTL_SEC = 24 * 60 * 60;
export const SESSION_TTL_SEC = 6 * 60 * 60;

export function memoryStore(): Store {
  const data = new Map<string, { value: unknown; expires: number }>();
  const live = (key: string) => {
    const hit = data.get(key);
    if (hit && hit.expires < Date.now()) data.delete(key);
    return data.get(key);
  };
  return {
    kind: "memory",
    async get<T>(key: string) {
      return (live(key)?.value as T) ?? null;
    },
    async set(key, value, ttlSec) {
      data.set(key, { value, expires: Date.now() + ttlSec * 1000 });
    },
    async incr(key, ttlSec) {
      const next = ((live(key)?.value as number) ?? 0) + 1;
      data.set(key, { value: next, expires: live(key)?.expires ?? Date.now() + ttlSec * 1000 });
      return next;
    },
  };
}

export function upstashStore(url: string, token: string): Store {
  const redis = new Redis({ url, token });
  return {
    kind: "upstash",
    get: (key) => redis.get(key),
    async set(key, value, ttlSec) {
      await redis.set(key, value, { ex: ttlSec });
    },
    async incr(key, ttlSec) {
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, ttlSec);
      return n;
    },
  };
}

let shared: Store | undefined;

export function getStore(): Store {
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
  shared ??= url && token ? upstashStore(url, token) : memoryStore();
  return shared;
}

export function capsFromEnv(): Caps {
  return {
    session: Number(process.env.QLOO_SESSION_CAP ?? 8),
    daily: Number(process.env.QLOO_DAILY_CAP ?? 300),
  };
}

export function requestKey(params: Record<string, string>): string {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/** Cached upstream call; only cache misses spend the session and daily budget. */
export async function budgeted<T>(store: Store, sessionId: string, key: string, fetcher: () => Promise<T>, caps: Caps): Promise<T> {
  const cacheKey = `cache:${key}`;
  const hit = await store.get<T>(cacheKey);
  if (hit !== null) return hit;

  const day = new Date().toISOString().slice(0, 10);
  if ((await store.incr(`daily:${day}`, 26 * 60 * 60)) > caps.daily) throw new LimitError("daily");
  if ((await store.incr(`session:${sessionId}`, SESSION_TTL_SEC)) > caps.session) throw new LimitError("session");

  const value = await fetcher();
  await store.set(cacheKey, value, CACHE_TTL_SEC);
  return value;
}
