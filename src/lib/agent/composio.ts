import { Composio } from "@composio/core";
import { AnthropicProvider } from "@composio/anthropic";
import type Anthropic from "@anthropic-ai/sdk";
import { appUrl } from "../config";

/**
 * Composio = hundreds of third-party apps (HubSpot, Gmail, Notion, Linear...).
 * Docs: https://docs.composio.dev/docs/how-composio-works
 *
 * - One Composio "user" per Slack user per workspace => per-user OAuth, never shared admin creds.
 * - A session gives Claude a small set of meta tools (search tools / get schemas / multi-execute)
 *   instead of hundreds of tool definitions, which keeps token use low.
 * - We turn off Composio's in-chat connection manager and send connect links privately
 *   (ephemeral message / dashboard), so a link never lands in a public thread.
 */
let client: Composio<AnthropicProvider> | null = null;

export function composioEnabled(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY);
}

export function composio(): Composio<AnthropicProvider> {
  if (!client) {
    client = new Composio({
      apiKey: process.env.COMPOSIO_API_KEY,
      provider: new AnthropicProvider(),
    });
  }
  return client;
}

export function composioUserId(teamId: string, slackUserId: string): string {
  return `${teamId}:${slackUserId}`;
}

type ComposioSession = Awaited<ReturnType<Composio<AnthropicProvider>["create"]>>;

export async function getSession(userId: string, sessionId?: string | null): Promise<ComposioSession> {
  if (sessionId) {
    try {
      return await composio().use(sessionId);
    } catch {
      // fall through and create a new one
    }
  }
  return composio().create(userId, {
    manageConnections: false,
    sandbox: { enable: false },
  });
}

export async function getComposioTools(session: ComposioSession): Promise<Anthropic.Tool[]> {
  return (await session.tools()) as unknown as Anthropic.Tool[];
}

export async function executeComposioTool(session: ComposioSession, toolUse: Anthropic.ToolUseBlock): Promise<string> {
  return composio().provider.executeToolCall(session, toolUse as never);
}

/** A hosted Connect Link for one app (OAuth handled by Composio). */
export async function createConnectLink(userId: string, toolkit: string): Promise<string> {
  const session = await composio().create(userId, { manageConnections: false, sandbox: { enable: false } });
  const req = await session.authorize(normalizeToolkit(toolkit), {
    callbackUrl: `${appUrl()}/connected?app=${encodeURIComponent(toolkit)}`,
  });
  if (!req.redirectUrl) throw new Error(`Composio did not return a connect link for ${toolkit}`);
  return req.redirectUrl;
}

export interface ConnectedApp {
  slug: string;
  name: string;
  logo?: string;
}

export async function listConnectedApps(userId: string): Promise<ConnectedApp[]> {
  if (!composioEnabled()) return [];
  const session = await composio().create(userId, { manageConnections: false, sandbox: { enable: false } });
  const res = await session.toolkits({ isConnected: true, limit: 50 });
  return res.items
    .filter((i) => i.connection?.isActive)
    .map((i) => ({ slug: i.slug, name: i.name, logo: i.logo }));
}

/** Remove every connected account for these Composio users (used by delete-my-data). */
export async function deleteConnectionsForUsers(userIds: string[]): Promise<number> {
  if (!composioEnabled() || userIds.length === 0) return 0;
  const c = composio();
  let deleted = 0;
  const list = await c.connectedAccounts.list({ userIds });
  for (const acct of list.items ?? []) {
    await c.connectedAccounts.delete(acct.id);
    deleted++;
  }
  return deleted;
}

/** "HubSpot" / "google sheets" -> "hubspot" / "googlesheets" (Composio toolkit slugs). */
export function normalizeToolkit(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, "");
}
