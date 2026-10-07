import { store, json, ID_RE, DEVICE_RE, clip, sha256, readJson, rateLimit, countPrefix } from "../lib/shared.mjs";

const HIDE_AFTER = 3; // distinct devices

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, { allow: "POST" });
  const body = await readJson(req);
  const spotId = body && String(body.spotId || "");
  const device = body && String(body.device || "");
  if (!ID_RE.test(spotId) || !DEVICE_RE.test(device)) return json({ error: "Invalid request." }, 400);
  if (!(await rateLimit(context.ip, "report", 20, 3_600_000))) return json({ error: "Too many reports. Try later." }, 429);

  const spots = store("spots");
  const spot = await spots.get(spotId, { type: "json" });
  if (!spot) return json({ ok: true });

  await store("reports").setJSON(`${spotId}/${await sha256(device)}`, {
    reason: clip(body.reason, 40) || "flag",
    at: Date.now(),
  });
  if (!spot.hiddenAt && (await countPrefix("reports", `${spotId}/`)) >= HIDE_AFTER) {
    spot.hiddenAt = Date.now();
    await spots.setJSON(spotId, spot);
  }
  return json({ ok: true });
};

export const config = { path: "/api/report" };
