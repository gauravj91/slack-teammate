import { describe, expect, it } from "vitest";
import { classifySlug, classifyToolCall, maxKind, needsApproval } from "@/lib/agent/approval";

const ctx = { currentChannel: "C_HERE" };

describe("classifySlug", () => {
  it.each([
    ["GMAIL_SEND_EMAIL", "external_send"],
    ["SLACK_SEND_MESSAGE", "external_send"],
    ["HUBSPOT_CREATE_CONTACT", "write"],
    ["GITHUB_CREATE_ISSUE_COMMENT", "write"],
    ["NOTION_DELETE_BLOCK", "write"],
    ["GMAIL_FETCH_EMAILS", "read"],
    ["HUBSPOT_LIST_DEALS", "read"],
    ["GOOGLESHEETS_GET_SPREADSHEET_INFO", "read"],
    ["OUTLOOK_OUTLOOK_SEND_EMAIL", "external_send"],
    ["GMAIL_CREATE_EMAIL_DRAFT", "write"],
  ])("%s -> %s", (slug, kind) => {
    expect(classifySlug(slug)).toBe(kind);
  });

  it("treats unknown verbs as writes (conservative)", () => {
    expect(classifySlug("ACME_FROBNICATE_WIDGET")).toBe("write");
  });
});

describe("classifyToolCall", () => {
  it("native read and internal tools", () => {
    expect(classifyToolCall("slack_read_channel", { channel: "C1" }, ctx)).toBe("read");
    expect(classifyToolCall("save_playbook", {}, ctx)).toBe("internal");
    expect(classifyToolCall("create_schedule", {}, ctx)).toBe("internal");
  });

  it("posting to the current channel is a write, elsewhere an external send", () => {
    expect(classifyToolCall("slack_post_message", { channel: "C_HERE", text: "x" }, ctx)).toBe("write");
    expect(classifyToolCall("slack_post_message", { channel: "C_OTHER", text: "x" }, ctx)).toBe("external_send");
  });

  it("Composio meta tools: search is read, multi-execute takes the most severe inner tool", () => {
    expect(classifyToolCall("COMPOSIO_SEARCH_TOOLS", {}, ctx)).toBe("read");
    expect(
      classifyToolCall("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "HUBSPOT_LIST_DEALS" }, { tool_slug: "GMAIL_SEND_EMAIL" }] }, ctx),
    ).toBe("external_send");
    expect(classifyToolCall("COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "HUBSPOT_LIST_DEALS" }] }, ctx)).toBe("read");
    expect(classifyToolCall("COMPOSIO_MULTI_EXECUTE_TOOL", {}, ctx)).toBe("write");
    expect(classifyToolCall("COMPOSIO_REMOTE_BASH_TOOL", {}, ctx)).toBe("write");
  });

  it("maxKind picks the most severe", () => {
    expect(maxKind(["read", "internal"])).toBe("internal");
    expect(maxKind([])).toBe("read");
  });
});

describe("needsApproval", () => {
  it("ask_writes gates writes and sends, not reads or internal", () => {
    expect(needsApproval("read", "ask_writes")).toBe(false);
    expect(needsApproval("internal", "ask_writes")).toBe(false);
    expect(needsApproval("write", "ask_writes")).toBe(true);
    expect(needsApproval("external_send", "ask_writes")).toBe(true);
  });
  it("ask_external gates only external sends", () => {
    expect(needsApproval("write", "ask_external")).toBe(false);
    expect(needsApproval("external_send", "ask_external")).toBe(true);
  });
  it("full_auto never gates", () => {
    expect(needsApproval("external_send", "full_auto")).toBe(false);
  });
});
