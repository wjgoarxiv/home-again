import "server-only";
import { cookies } from "next/headers";
import { SESSION_TTL_SEC } from "./limits";

const COOKIE = "ha_sid";

/** Anonymous per-browser id that the Qloo and model budgets are counted against. */
export async function sessionId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  if (existing) return existing;
  const id = crypto.randomUUID();
  jar.set(COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: SESSION_TTL_SEC, path: "/" });
  return id;
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
