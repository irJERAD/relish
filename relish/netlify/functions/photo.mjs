import { store, ID_RE } from "../lib/shared.mjs";

export default async (req) => {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!ID_RE.test(id)) return new Response("Bad id", { status: 400 });
  const data = await store("photos").get(id, { type: "arrayBuffer" });
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(data, {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
  });
};

export const config = { path: "/api/photo" };
