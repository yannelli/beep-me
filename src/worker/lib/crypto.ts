const encoder = new TextEncoder();
const decoder = new TextDecoder();
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function randomString(length: number, alphabet = BASE62): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
  let out = "";
  for (const byte of bytes) {
    if (byte < 256 - (256 % alphabet.length)) out += alphabet[byte % alphabet.length];
    if (out.length === length) return out;
  }
  return out + randomString(length - out.length, alphabet);
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomString(16)}`;
}

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Base64url(value: string): Promise<string> {
  return base64url(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type KeyPurpose = "channel-secrets" | "session" | "callback" | "oauth-state";
const keyCache = new Map<string, Promise<CryptoKey>>();

function deriveKey(secret: string, purpose: KeyPurpose, usage: "aes" | "hmac"): Promise<CryptoKey> {
  const cacheKey = `${purpose}:${usage}:${secret}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = crypto.subtle
      .importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"])
      .then((base) =>
        crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: encoder.encode("beep-me/v1"), info: encoder.encode(purpose) },
          base,
          usage === "aes" ? { name: "AES-GCM", length: 256 } : { name: "HMAC", hash: "SHA-256", length: 256 },
          false,
          usage === "aes" ? ["encrypt", "decrypt"] : ["sign", "verify"],
        ),
      );
    keyCache.set(cacheKey, key);
  }
  return key;
}

export async function encryptJson(secret: string, value: unknown): Promise<string> {
  const key = await deriveKey(secret, "channel-secrets", "aes");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(value)));
  return `v1.${base64url(iv)}.${base64url(data)}`;
}

export async function decryptJson<T>(secret: string, sealed: string): Promise<T> {
  const [version, iv, data] = sealed.split(".");
  if (version !== "v1" || !iv || !data) throw new Error("Unknown sealed value format");
  const key = await deriveKey(secret, "channel-secrets", "aes");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64url(iv) }, key, fromBase64url(data));
  return JSON.parse(decoder.decode(plain)) as T;
}

export async function hmacSign(secret: string, purpose: KeyPurpose, value: string): Promise<string> {
  const key = await deriveKey(secret, purpose, "hmac");
  return base64url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function hmacVerify(secret: string, purpose: KeyPurpose, value: string, signature: string): Promise<boolean> {
  return timingSafeEqual(await hmacSign(secret, purpose, value), signature);
}
