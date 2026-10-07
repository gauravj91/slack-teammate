import { db, type Job } from "./db";
import { appUrl } from "./config";

export async function enqueueJob(job: {
  team_id: string;
  source: Job["source"];
  event_id?: string | null;
  slack_user_id: string;
  channel_id: string;
  thread_ts?: string | null;
  prompt: string;
  schedule_id?: string | null;
  state?: Record<string, unknown>;
}): Promise<Job | null> {
  const { data, error } = await db().from("jobs").insert({ ...job, state: job.state ?? {} }).select("*").single();
  if (error) {
    if (error.code === "23505") return null; // duplicate Slack event (retry) - already queued
    throw new Error(error.message);
  }
  return data as Job;
}

export async function claimJobs(limit = 3, jobId?: string): Promise<Job[]> {
  const { data, error } = await db().rpc("claim_jobs", { p_limit: limit, p_job_id: jobId ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []) as Job[];
}

export async function updateJob(id: string, patch: Partial<Job> & Record<string, unknown>) {
  const { error } = await db().from("jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) console.error("updateJob failed", error.message);
}

/** Ask a fresh function invocation to pick up a job (used when a run hands work back to the queue). */
export async function kickWorker(jobId?: string) {
  try {
    await fetch(`${appUrl()}/api/worker`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CRON_SECRET}` },
      body: JSON.stringify({ jobId }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // The every-minute tick will pick it up anyway.
  }
}
