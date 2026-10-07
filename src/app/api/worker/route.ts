import { waitUntil } from "@vercel/functions";
import { drainQueue, isAuthorizedInternal } from "@/lib/worker";

export const maxDuration = 300;

/** Drain the job queue. Called by the app itself (to continue long tasks in a fresh invocation). */
export async function POST(req: Request) {
  if (!isAuthorizedInternal(req)) return new Response("unauthorized", { status: 401 });
  const { jobId } = (await req.json().catch(() => ({}))) as { jobId?: string };
  waitUntil(drainQueue({ jobId, maxMs: 280_000 }).catch((e) => console.error("drain failed", e)));
  return Response.json({ accepted: true }, { status: 202 });
}
