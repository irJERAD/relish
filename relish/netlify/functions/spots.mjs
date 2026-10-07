import { store, json, CATS, ID_RE, DEVICE_RE, clip, sha256, readJson, rateLimit, publicSpot } from "../lib/shared.mjs";

const MAX_PHOTO = 600_000;  // base64 chars (~440 KB JPEG)
const MAX_THUMB = 60_000;
const JPEG_URL = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/;

export default async (req, context) => {
  if (req.method === "GET") return list();
  if (req.method === "POST") return create(req, context);
  if (req.method === "DELETE") return remove(req);
  return json({ error: "Method not allowed" }, 405, { allow: "GET, POST, DELETE" });
};

export const config = { path: "/api/spots" };

async function list() {
  const spots = store("spots");
  const { blobs } = await spots.list();
  const items = (await Promise.all(blobs.map((b) => spots.get(b.key, { type: "json" }))))
    .filter((s) => s && !s.hiddenAt);
  const counts = {};
  for (const b of (await store("finds").list()).blobs) {
    const id = b.key.split("/")[0];
    counts[id] = (counts[id] || 0) + 1;
  }
  items.sort((a, b) => b.createdAt - a.createdAt);
  return json(items.slice(0, 1000).map((s) => publicSpot(s, counts[s.id] || 0)));
}

function fuzz(lat, lng) {
  const d = 50 + Math.random() * 120, b = Math.random() * 2 * Math.PI;
  return {
    lat: lat + (d * Math.cos(b)) / 110540,
    lng: lng + (d * Math.sin(b)) / (111320 * Math.cos((lat * Math.PI) / 180)),
  };
}

function decodeJpeg(dataUrl, max) {
  if (typeof dataUrl !== "string" || dataUrl.length > max) return null;
  const m = dataUrl.match(JPEG_URL);
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  return buf;
}

async function create(req, context) {
  const body = await readJson(req);
  if (!body) return json({ error: "Invalid request." }, 400);
  if (!(await rateLimit(context.ip, "post", 12, 3_600_000)))
    return json({ error: "You've posted a lot in the last hour. Try again a bit later." }, 429);

  const category = CATS.includes(body.category) ? body.category : null;
  const title = clip(body.title, 80);
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!category || !title || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return json({ error: "A name, category and location are required." }, 400);

  const photo = decodeJpeg(body.photo, MAX_PHOTO);
  const thumbOk = typeof body.thumb === "string" && body.thumb.length <= MAX_THUMB && JPEG_URL.test(body.thumb);
  if (!photo || !thumbOk) return json({ error: "The photo is missing or too large." }, 400);

  const precision = body.precision === "approx" ? "approx" : "exact";
  // Approximate spots are fuzzed here, so the exact point is never stored.
  const where = precision === "approx" ? fuzz(lat, lng) : { lat, lng };
  const id = crypto.randomUUID();
  const deleteToken = crypto.randomUUID();
  const spot = {
    id, title, category, precision,
    artist: clip(body.artist, 80),
    note: clip(body.note, 500),
    lat: +where.lat.toFixed(6),
    lng: +where.lng.toFixed(6),
    thumb: body.thumb,
    createdAt: Date.now(),
    tokenHash: await sha256(deleteToken),
  };
  await store("photos").set(id, new Blob([photo], { type: "image/jpeg" }));
  await store("spots").setJSON(id, spot);
  return json({ spot: publicSpot(spot, 0), deleteToken }, 201);
}

async function remove(req) {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!ID_RE.test(id)) return json({ error: "Bad id." }, 400);
  const spots = store("spots");
  const spot = await spots.get(id, { type: "json" });
  if (!spot) return json({ ok: true });

  const token = req.headers.get("x-delete-token") || "";
  const adminSent = req.headers.get("x-admin-token") || "";
  const admin = process.env.GLINT_ADMIN_TOKEN || "";
  const allowed = (token && (await sha256(token)) === spot.tokenHash) || (admin && adminSent === admin);
  if (!allowed) return json({ error: "Only the person who posted this can delete it." }, 403);

  await spots.delete(id);
  await store("photos").delete(id);
  for (const name of ["finds", "reports"]) {
    const s = store(name);
    const { blobs } = await s.list({ prefix: `${id}/` });
    await Promise.all(blobs.map((b) => s.delete(b.key)));
  }
  return json({ ok: true });
}
