# Glint

Spot, photograph and share local art: painted trash cans and murals (Public),
graffiti and tucked-away pieces (Hidden), and nature's art like a striking tree (Nature).

Vanilla HTML/JS front end, Leaflet + OpenStreetMap map, and a small Netlify
Functions + Netlify Blobs backend. No accounts, no database to set up.

## Layout

    public/            static site (index.html, app.js, styles.css)
    netlify/functions/ API: spots.mjs, photo.mjs, finds.mjs, report.mjs
    netlify/lib/       shared helpers
    netlify.toml       build settings + security headers (CSP)

## API

    GET    /api/spots            list visible spots (with check-in counts)
    POST   /api/spots            create {title, category, artist, note, lat, lng, precision, photo, thumb}
                                 -> {spot, deleteToken}
    DELETE /api/spots?id=...     header x-delete-token (poster) or x-admin-token
    GET    /api/photo?id=...     full JPEG
    POST   /api/finds            {spotId, device, found}  -> {count}
    POST   /api/report           {spotId, device, reason}

## How it behaves

- Identity is an anonymous random device id in localStorage. The server stores
  only a hash of it for check-ins and reports.
- Posting returns a delete token kept on the poster's device; only that device
  (or the admin) can delete the spot.
- "Approximate" spots are fuzzed 50-170 m on the server, so the exact point is
  never stored. The map shows a 200 m circle.
- Rate limits per IP: 12 posts/hour, 120 check-ins/hour, 20 reports/hour.
- A spot reported from 3 different devices is hidden automatically. Restore or
  remove it in the Netlify Blobs "spots" store (delete the hiddenAt field).
- Photos are resized in the browser (max ~1600 px JPEG) before upload.

## Deploy

Functions with dependencies need a build, so use the CLI or a Git repo
(drag-and-drop deploys skip functions):

A Netlify project already exists for this: glint-art
(https://glint-art.netlify.app). From this folder:

    npm install
    npx netlify-cli login
    npx netlify-cli link --id ac7bc354-f901-4478-8e61-8065a9330224
    npx netlify-cli deploy --build --prod

Optional: set `GLINT_ADMIN_TOKEN` in Site settings > Environment variables.
Then open `https://<your-site>/#admin=<token>` once on your phone to unlock
delete on every spot.

## Notes

- Map tiles come from tile.openstreetmap.org. That is fine for a small
  community app; if traffic grows, switch to a hosted tile provider
  (change the URL in app.js and the img-src line in netlify.toml).
- Local dev: `npx netlify-cli dev` runs the site and functions together.
- Production writes to site-wide blob stores; deploy previews and local dev
  use deploy-scoped stores, so test posts never reach the live map.
