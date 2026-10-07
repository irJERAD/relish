import { store, json, ID_RE, DEVICE_RE, sha256, readJson, rateLimit, countPrefix } from "../lib/shared.mjs";

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, { allow: "POST" });
  const body = await readJson(req);
  const spotId = body && String(body.spotId || "");
  const device = body && String(body.device || "");
  if (!ID_RE.test(spotId) || !DEVICE_RE.test(device)) return json({ error: "Invalid request." }, 400);
  if (!(await store("spots").get(spotId))) return json({ error: "That spot no longer exists." }, 404);
  if (!(await rateLimit(context.ip, "finds", 120, 3_600_000))) return json({ error: "Slow down a little." }, 429);

  const key = `${spotId}/${await sha256(device)}`;
  const finds = store("finds");
  if (body.found) await finds.set(key, String(Date.now()));
  else await finds.delete(key);
  return json({ count: await countPrefix("finds", `${spotId}/`) });
};

export const config = { path: "/api/finds" };
