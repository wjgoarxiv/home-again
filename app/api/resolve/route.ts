import { readJson, sessionId } from "@/lib/session";
import { handleResolve, liveEnv } from "@/lib/turn";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const sid = await sessionId();
  const reply = await handleResolve(await readJson(req), liveEnv(sid));
  return Response.json(reply.body, { status: reply.status });
}
