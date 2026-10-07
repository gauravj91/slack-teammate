import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt, sign, unsign } from "@/lib/crypto";
import { rankPlaybooks } from "@/lib/agent/context";
import { summarize } from "@/lib/audit";
import { isPublicHttpUrl } from "@/lib/agent/web";

const key = randomBytes(32).toString("base64");

describe("crypto", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("xoxb-secret", key);
    const b = encrypt("xoxb-secret", key);
    expect(a).not.toBe(b);
    expect(decrypt(a, key)).toBe("xoxb-secret");
  });
  it("fails with the wrong key or tampered data", () => {
    const c = encrypt("xoxb-secret", key);
    expect(() => decrypt(c, randomBytes(32).toString("base64"))).toThrow();
    const parts = c.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join(":"), key)).toThrow();
  });
  it("signs and verifies values", () => {
    const s = sign("nonce123", "k");
    expect(unsign(s, "k")).toBe("nonce123");
    expect(unsign(s + "x", "k")).toBeNull();
    expect(unsign(s, "other")).toBeNull();
  });
});

describe("rankPlaybooks", () => {
  const pbs = [
    { name: "Weekly pipeline summary", content: "Pull HubSpot deals, group by owner, post to #sales" },
    { name: "Customer onboarding", content: "Create Notion page, invite to shared Slack channel" },
    { name: "Expense reports", content: "Collect receipts from Gmail" },
  ];
  it("finds the relevant playbook", () => {
    expect(rankPlaybooks("send the pipeline summary to sales", pbs)[0].name).toBe("Weekly pipeline summary");
    expect(rankPlaybooks("onboard the new customer Acme", pbs)[0].name).toBe("Customer onboarding");
  });
  it("returns nothing for unrelated requests", () => {
    expect(rankPlaybooks("what's the weather", pbs)).toEqual([]);
  });
});

describe("audit summarize", () => {
  it("redacts secrets and truncates", () => {
    const s = summarize({ to: "a@b.com", api_key: "sk-123", nested: { password: "p" } });
    expect(s).toContain("a@b.com");
    expect(s).not.toContain("sk-123");
    expect(s).not.toContain('"p"');
    expect(summarize("x".repeat(1000), 50).length).toBe(50);
  });
});

describe("web_fetch SSRF guard", () => {
  it.each([
    ["https://example.com/page", true],
    ["http://localhost:3000", false],
    ["http://127.0.0.1", false],
    ["http://10.1.2.3", false],
    ["http://169.254.169.254/latest/meta-data", false],
    ["http://192.168.0.1", false],
    ["file:///etc/passwd", false],
    ["http://[::1]/", false],
  ])("%s -> %s", (url, ok) => {
    expect(isPublicHttpUrl(url)).toBe(ok);
  });
});
