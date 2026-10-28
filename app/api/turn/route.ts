import { readJson, sessionId } from "@/lib/session";
import { handleTurn, liveEnv } from "@/lib/turn";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const sid = await sessionId();
  const reply = await handleTurn(await readJson(req), sid, liveEnv(sid));
  return Response.json(reply.body, { status: reply.status });
}
