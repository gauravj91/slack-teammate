import { waitUntil } from "@vercel/functions";
import { drainQueue, enqueueDueSchedules, isAuthorizedInternal } from "@/lib/worker";

export const maxDuration = 300;

/**
 * Called every minute by Supabase pg_cron + pg_net (see supabase/migrations/0003_cron.sql).
 * 1) enqueue a job for each due schedule, 2) drain the queue (new jobs, resumed approvals,
 * long tasks handed back by an earlier invocation, jobs whose worker crashed).
 */
async function tick(req: Request) {
  if (!isAuthorizedInternal(req)) return new Response("unauthorized", { status: 401 });
  const scheduled = await enqueueDueSchedules();
  waitUntil(drainQueue({ maxMs: 280_000 }).catch((e) => console.error("drain failed", e)));
  return Response.json({ ok: true, scheduled });
}

export const POST = tick;
export const GET = tick;
