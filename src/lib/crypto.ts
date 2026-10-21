import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import type { SiteSecrets } from "./types";

const ALGO = "aes-256-gcm";

function getKey() {
  const secret = process.env.CREDENTIALS_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("CREDENTIALS_SECRET mancante o troppo corta (min 16 caratteri)");
  }
  return scryptSync(secret, "site-guard-salt", 32);
}

export function encryptSecrets(secrets: SiteSecrets): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(secrets), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecrets(payload: string): SiteSecrets {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as SiteSecrets;
}
