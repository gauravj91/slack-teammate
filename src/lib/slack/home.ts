import { db, isAdmin, type Team } from "../db";
import { slackCall } from "./api";
import { homeView } from "./blocks";
import { composioUserId, listConnectedApps } from "../agent/composio";

/** Publish the App Home tab (doubles as the onboarding checklist). */
export async function publishHome(team: Team, token: string, userId: string) {
  const [apps, pb, sc] = await Promise.all([
    listConnectedApps(composioUserId(team.id, userId)).catch(() => []),
    db().from("playbooks").select("id", { count: "exact", head: true }).eq("team_id", team.id),
    db().from("schedules").select("id", { count: "exact", head: true }).eq("team_id", team.id),
  ]);
  await slackCall("views.publish", token, {
    user_id: userId,
    view: homeView(team, {
      apps: apps.length,
      playbooks: pb.count ?? 0,
      schedules: sc.count ?? 0,
      isAdmin: isAdmin(team, userId),
    }),
  });
}
