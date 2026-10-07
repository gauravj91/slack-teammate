import { db, type Playbook } from "../db";

const STOP = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with", "how", "we", "do", "is", "it",
  "me", "my", "our", "you", "your", "this", "that", "please", "can", "could", "would", "send", "get",
]);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s#-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Rank playbooks by keyword overlap with the request (name matches count triple). Cheap and good enough
 *  for tens of playbooks; swap for pgvector embeddings when a team has hundreds. */
export function rankPlaybooks<T extends Pick<Playbook, "name" | "content">>(request: string, playbooks: T[], limit = 3): T[] {
  const q = new Set(tokenize(request));
  if (q.size === 0) return [];
  return playbooks
    .map((p) => {
      const nameHits = tokenize(p.name).filter((w) => q.has(w)).length;
      const body = new Set(tokenize(p.content.slice(0, 4000)));
      let bodyHits = 0;
      for (const w of q) if (body.has(w)) bodyHits++;
      return { p, score: nameHits * 3 + bodyHits };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
}

export interface TeamContext {
  playbooks: Pick<Playbook, "name" | "content">[];
  allPlaybookNames: string[];
  memories: string[];
}

export async function loadTeamContext(teamId: string, request: string): Promise<TeamContext> {
  const [pb, mem] = await Promise.all([
    db().from("playbooks").select("name, content").eq("team_id", teamId).order("updated_at", { ascending: false }).limit(200),
    db().from("memories").select("fact").eq("team_id", teamId).order("created_at", { ascending: false }).limit(40),
  ]);
  const playbooks = (pb.data ?? []) as Pick<Playbook, "name" | "content">[];
  return {
    playbooks: rankPlaybooks(request, playbooks),
    allPlaybookNames: playbooks.map((p) => p.name),
    memories: (mem.data ?? []).map((m) => m.fact as string),
  };
}
