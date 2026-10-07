import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * AES-256-GCM encryption for secrets at rest (Slack bot tokens).
 * ENCRYPTION_KEY must be 32 random bytes, base64-encoded:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
function getKey(key?: string): Buffer {
  const raw = key ?? process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("Missing ENCRYPTION_KEY");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return buf;
}

export function encrypt(plaintext: string, key?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(key), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decrypt(payload: string, key?: string): string {
  const [version, iv, tag, ct] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", getKey(key), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

/** HMAC-signed values (OAuth state, approval tokens). */
export function sign(value: string, secret = process.env.ENCRYPTION_KEY || ""): string {
  const mac = createHmac("sha256", secret).update(value).digest("base64url");
  return `${value}.${mac}`;
}

export function unsign(signed: string, secret = process.env.ENCRYPTION_KEY || ""): string | null {
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const expected = Buffer.from(sign(value, secret).slice(i + 1));
  const given = Buffer.from(signed.slice(i + 1));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return value;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
