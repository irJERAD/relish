import { getStore, getDeployStore } from "@netlify/blobs";

export const CATS = ["public", "hidden", "nature"];
export const ID_RE = /^[a-f0-9-]{36}$/i;          // crypto.randomUUID()
export const DEVICE_RE = /^[a-z0-9-]{16,64}$/i;

// Production uses the site-wide stores; previews and local dev get deploy-scoped
// stores so test posts never mix with real ones.
export const store = (name) =>
  globalThis.Netlify?.context?.deploy?.context === "production"
    ? getStore({ name, consistency: "strong" })
    : getDeployStore({ name, consistency: "strong" });

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

export const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function readJson(req) {
  try { return await req.json(); } catch { return null; }
}

// Simple sliding-window limit per IP (hashed, never stored raw).
export async function rateLimit(ip, bucket, max, windowMs) {
  const key = `${bucket}/${await sha256(ip || "unknown")}`;
  const s = store("rate");
  const now = Date.now();
  const prev = (await s.get(key, { type: "json" })) || [];
  const recent = prev.filter((t) => now - t < windowMs);
  if (recent.length >= max) return false;
  recent.push(now);
  await s.setJSON(key, recent);
  return true;
}

// Never send the delete-token hash or moderation fields to clients.
export function publicSpot(s, finds = 0) {
  const { tokenHash, hiddenAt, ...rest } = s;
  return { ...rest, finds };
}

export async function countPrefix(storeName, prefix) {
  const { blobs } = await store(storeName).list({ prefix });
  return blobs.length;
}
