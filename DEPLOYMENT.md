# RTBW CMS — Render + Supabase Deployment Guide

Architecture:

```
Render (web service)
   ↓
Supabase PostgreSQL   ← blogs, image-slot URLs, editable text, media refs, admin user, sessions
   ↓
Supabase Storage      ← the actual uploaded image files (permanent public URLs)
```

Nothing admin-editable is written to Render's local disk, so your data survives
redeploys, restarts, crashes, instance replacement and rebuilds.

The Supabase **service-role key** is used only on the server (Render). It is
never sent to the browser, never appears in API responses, and never appears in
frontend code.

---

## 1. Supabase — get your database connection string

1. Supabase dashboard → **Project Settings → Database → Connection string → URI**.
2. Choose the **Connection pooler** tab (best for Render).
3. Copy the URI and replace `[YOUR-PASSWORD]` with your database password.
   It looks like:
   `postgres://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`

That's your `DATABASE_URL`. SSL is handled automatically — do **not** set `PGSSL`.

## 2. Supabase — get your API URL and service-role key

Supabase dashboard → **Project Settings → API**:

- **Project URL** → this is `SUPABASE_URL` (e.g. `https://<project-ref>.supabase.co`). Not secret.
- **Project API keys → `service_role`** → this is `SUPABASE_SERVICE_ROLE_KEY`. **Secret — server only.**

## 3. Supabase — create the Storage bucket

1. Supabase dashboard → **Storage → Create a new bucket**.
2. **Name:** `website-images` (recommended — matches the `SUPABASE_BUCKET` default).
3. **Public bucket:** **ON (public).**
   - The website displays these images directly by URL, so the bucket must be
     public for read. Uploads and deletes are done server-side with the
     service-role key, which bypasses policies regardless.
4. Create the bucket.

### Storage policies

- Because uploads/deletes go through the **service-role key**, they bypass Row
  Level Security — **no custom write policies are required**.
- Making the bucket **public** gives anonymous read access to files, which is
  what the public website needs. That is the only access the browser gets.
- If you leave the bucket **private** instead, public `…/object/public/…` URLs
  return 403 and images won't show. So: **use a public bucket.**

## 4. Deploy the web service on Render

**Option A — Blueprint (`render.yaml`):**
1. Push this repo to GitHub.
2. Render → **New + → Blueprint**, select the repo.
3. Fill in the `sync: false` variables when prompted (see step 5).

**Option B — Manual web service:**
1. **New + → Web Service**, connect the repo.
2. **Build Command:** `npm install`
3. **Start Command:** `npm start`
4. Add the environment variables in step 5.

## 5. Environment variables (Render → service → Environment)

| Variable                    | Required | Value |
|-----------------------------|----------|-------|
| `DATABASE_URL`              | Yes      | Supabase pooler URI (step 1) |
| `SUPABASE_URL`              | Yes      | Supabase Project URL (step 2) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes      | Supabase service_role key (step 2) — secret |
| `SUPABASE_BUCKET`           | Optional | Bucket name (default `website-images`) |
| `SESSION_SECRET`            | Yes      | Long random string (generate below) |
| `ADMIN_EMAIL`               | Yes      | Admin login email (first boot only) |
| `ADMIN_PASSWORD`            | Yes      | Strong admin password (first boot only) |
| `NODE_ENV`                  | Yes      | `production` |
| `PG_POOL_MAX`               | Optional | `5` (keeps within Supabase pooler limits) |

Generate a session secret:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

No Cloudinary variables are used anywhere.

## 6. First boot

On first start the server automatically:
- Creates all tables (`users`, `media`, `blogs`, `image_slots`, `text_slots`, `session`) in Supabase Postgres.
- Seeds the admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- Seeds default image slots and text slots.

Log in at `https://<your-app>.onrender.com/admin`.

> The admin user is seeded only when there are zero users. Changing
> `ADMIN_PASSWORD` later won't update an existing admin — reset it in the DB.

---

## Deployment checklist

- [ ] Supabase `DATABASE_URL` (pooler URI) copied.
- [ ] Supabase `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` copied.
- [ ] Storage bucket `website-images` created and set to **public**.
- [ ] Render web service created (Build `npm install`, Start `npm start`).
- [ ] Env vars set (table above), `NODE_ENV=production`.
- [ ] Deployed; logged in at `/admin`.
- [ ] Uploaded a test image → it appears on the site.
- [ ] Restarted the Render service → image and text edits still present.

---

## Acceptance test (persistence)

1. Log into `/admin`, upload/replace an image on a slot, and edit some text.
2. In Render: **Manual Deploy → Clear build cache & deploy** (or **Restart**).
3. Reload the public site: the uploaded image and edited text are still present.

Images live in Supabase Storage and their URLs (plus all text) live in Supabase
Postgres, so nothing depends on the Render instance's disk.
