import { db, type Schedule } from "./db";
import { claimJobs, enqueueJob } from "./jobs";
import { processJob } from "./agent/run";
import { nextRunAfter } from "./schedule";
import { safeEqual } from "./crypto";

/** Bearer-token check for internal endpoints (pg_cron tick, worker kicks). */
export function isAuthorizedInternal(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  return safeEqual(header, `Bearer ${secret}`);
}

/** Process queued jobs until the queue is empty or we approach the function time limit. */
export async function drainQueue(opts: { jobId?: string; maxMs?: number } = {}) {
  const deadline = Date.now() + (opts.maxMs ?? 200_000);
  let processed = 0;
  if (opts.jobId) {
    for (const job of await claimJobs(1, opts.jobId)) {
      await processJob(job);
      processed++;
    }
  }
  while (Date.now() < deadline - 30_000) {
    const jobs = await claimJobs(1);
    if (jobs.length === 0) break;
    await processJob(jobs[0]);
    processed++;
  }
  return processed;
}

/** Enqueue a job for every schedule that is due. Advancing next_run_at first makes double-firing impossible. */
export async function enqueueDueSchedules(now = new Date()): Promise<number> {
  const { data, error } = await db()
    .from("schedules")
    .select("*")
    .eq("enabled", true)
    .lte("next_run_at", now.toISOString())
    .limit(50);
  if (error) throw new Error(error.message);
  let count = 0;
  for (const s of (data ?? []) as Schedule[]) {
    const next = nextRunAfter(s.cron, s.timezone, now);
    const { data: claimed } = await db()
      .from("schedules")
      .update({ next_run_at: next.toISOString(), last_run_at: now.toISOString() })
      .eq("id", s.id)
      .eq("next_run_at", s.next_run_at!) // optimistic lock
      .select("id");
    if (!claimed?.length) continue;
    await enqueueJob({
      team_id: s.team_id,
      source: "schedule",
      slack_user_id: s.created_by,
      channel_id: s.channel_id,
      prompt: `Scheduled task "${s.name}":\n${s.prompt}`,
      schedule_id: s.id,
    });
    count++;
  }
  return count;
}
