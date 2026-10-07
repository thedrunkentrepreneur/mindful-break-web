# Running / deploying this backend without Replit

This is a plain Express app now — no Replit-specific code left in it.

## 1. Test locally right now (works today, zero new accounts)

From this folder:
```
node ./build.mjs
PORT=8080 NODE_ENV=production node --enable-source-maps ./dist/index.mjs
```
The Android emulator on this same PC reaches it automatically at `10.0.2.2:8080`
(the app's `lib/api.ts` already defaults to this). Good enough for local
testing on the emulator, but NOT reachable from a real phone or once you're
off this Wi-Fi network.

## 2. Permanent public URL (needed before a real device / real users)

Simplest free option: **Render.com** (no code changes needed, this Express
app runs as-is).

1. Create a free Render account, connect this repo (or upload this
   `api-server` folder as its own repo).
2. New "Web Service" -> Build command: `node build.mjs` -> Start command:
   `node --enable-source-maps dist/index.mjs` -> add env var `PORT` is set
   automatically by Render, no action needed.
3. Render gives you a permanent URL like `https://your-app.onrender.com`.
4. Set `EXPO_PUBLIC_API_BASE_URL=https://your-app.onrender.com/api` in
   `eas.json`'s `build.production.env` (same place the RevenueCat keys live),
   then rebuild the app.

Free tier note: Render's free web services sleep after ~15 min of no traffic
and take ~30-50s to wake up on the next request -- fine for a side project,
not for a polished first impression at scale. Upgrade to a paid instance
($7/mo) once real users depend on this working reliably.

## Data storage caveat

Stats are still stored in a flat `detox-stats.json` file on disk, written on
every request with no locking. Fine at low volume; if this app gets real
concurrent traffic, that file will need to become a real database (even
SQLite would be a big step up) before it can be trusted under load.
