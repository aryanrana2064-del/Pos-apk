# Deploy VYRO VX7 (Smart Business POS) — Vercel + API

The React terminal is at the **project root** (Vercel-ready). The FastAPI cloud API is in **`server/`** and must be hosted separately (Vercel does not run FastAPI).

## 1. Database (2 min)
Create a free MongoDB Atlas cluster → get the connection string (`mongodb+srv://...`).

## 2. API (Render / Railway / Fly)
Deploy the `server/` folder:
- Build: `pip install -r requirements.txt`
- Start: `uvicorn server:app --host 0.0.0.0 --port $PORT`
- Environment:
  ```
  MONGO_URL=mongodb+srv://...
  DB_NAME=vyro_vx7
  JWT_SECRET=<long random string>
  ADMIN_EMAIL=you@yourdomain.com
  ADMIN_PASSWORD=<strong password>
  CORS_ORIGINS=https://your-app.vercel.app
  ```
Check `https://your-api-host/api/` → `{"status":"ok"}`.

## 3. Frontend on Vercel
1. Push this folder to GitHub (or run `vercel` from it).
2. vercel.com/new → import the repo → Framework: **Create React App** (build `yarn build`, output `build`).
3. Environment variable: `REACT_APP_BACKEND_URL = https://your-api-host` (no trailing slash).
4. Deploy. `vercel.json` handles SPA rewrites, so `/dashboard`, `/billing`, `/admin` work on refresh.

If the repo contains both folders and Vercel's root is the repo root, set **Root Directory** to the folder that has `package.json`.

## 4. First run
- Open your Vercel URL → **Create Shop Account** → pick your **Business Type** → you get a 14-day trial key and an empty shop.
- Platform admin: sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` → you land on **`/admin`** → create real license keys (Starter/Pro/Business/Lifetime), extend `+30d`, revoke or re-activate.
- Install as an app: Chrome desktop → install icon in the address bar; Android Chrome → ⋮ → Install app.

## Notes
- Change `ADMIN_PASSWORD` before going live; it is re-applied on every API start.
- Set `CORS_ORIGINS` to your exact Vercel domain in production instead of `*`.
- Offline: the terminal keeps billing from cache and syncs queued bills when the connection returns.
