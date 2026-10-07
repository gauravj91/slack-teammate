import { waitUntil } from "@vercel/functions";
import { readVerifiedSlackBody } from "@/lib/slack/verify";
import { db, getBotToken, getTeam, isAllowed } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import { drainQueue } from "@/lib/worker";
import { publishHome } from "@/lib/slack/home";
import { slackClient } from "@/lib/slack/api";

export const maxDuration = 300;

interface SlackFile { name?: string; mimetype?: string; url_private?: string; size?: number }
interface SlackEvent {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
  tab?: string;
  files?: SlackFile[];
}

/**
 * Slack Events API endpoint. Must answer within 3 seconds, so we only verify, enqueue a job and
 * return 200; the agent runs afterwards via waitUntil (and the every-minute tick as a safety net).
 */
export async function POST(req: Request) {
  const raw = await readVerifiedSlackBody(req);
  if (raw === null) return new Response("invalid signature", { status: 401 });
  const body = JSON.parse(raw);

  if (body.type === "url_verification") return Response.json({ challenge: body.challenge });

  // Slack retries if we were slow; the first delivery is already queued (event_id is unique).
  if (req.headers.get("x-slack-retry-num")) return new Response("ok");

  if (body.type !== "event_callback") return new Response("ok");
  const teamId: string = body.team_id;
  const event: SlackEvent = body.event;

  if (event.type === "app_uninstalled" || event.type === "tokens_revoked") {
    await db().from("installations").delete().eq("team_id", teamId);
    return new Response("ok");
  }

  if (event.type === "app_home_opened" && event.tab === "home" && event.user) {
    waitUntil(
      (async () => {
        const team = await getTeam(teamId);
        const token = team && (await getBotToken(teamId));
        if (team && token) await publishHome(team, token, event.user!);
      })().catch((e) => console.error("home publish failed", e)),
    );
    return new Response("ok");
  }

  const isMention = event.type === "app_mention";
  const isDm =
    event.type === "message" &&
    event.channel_type === "im" &&
    !event.bot_id &&
    (!event.subtype || event.subtype === "file_share");
  if (!isMention && !isDm) return new Response("ok");
  if (!event.user || !event.channel || !event.ts) return new Response("ok");

  waitUntil(
    handleRequest(teamId, body.event_id, event, isMention ? "mention" : "dm").catch((e) => console.error("event handling failed", e)),
  );
  return new Response("ok");
}

async function handleRequest(teamId: string, eventId: string, event: SlackEvent, source: "mention" | "dm") {
  const team = await getTeam(teamId);
  const token = team && (await getBotToken(teamId));
  if (!team || !token) return;

  // In channels the event also fires for our own mentions of ourselves; ignore the bot.
  if (event.user === team.bot_user_id) return;

  if (!isAllowed(team, event.user!)) {
    await slackClient(token).postEphemeral({
      channel: event.channel!,
      user: event.user!,
      text: "Sorry, you're not on this workspace's allow-list for me. Ask an admin to add you in the dashboard.",
    });
    return;
  }

  const prompt = (event.text || "").replace(new RegExp(`<@${team.bot_user_id}>`, "g"), "").trim();
  const files = (event.files || [])
    .filter((f) => f.url_private && (f.size ?? 0) < 1_000_000)
    .map((f) => ({ name: f.name, mimetype: f.mimetype, url: f.url_private }));
  if (!prompt && files.length === 0) return;

  const job = await enqueueJob({
    team_id: teamId,
    source,
    event_id: eventId,
    slack_user_id: event.user!,
    channel_id: event.channel!,
    thread_ts: event.thread_ts || event.ts!,
    prompt: prompt || "(The user shared a file; see attachment.)",
    state: { eventTs: event.ts, inThread: Boolean(event.thread_ts && event.thread_ts !== event.ts), files },
  });
  if (job) await drainQueue({ jobId: job.id, maxMs: 280_000 });
}
