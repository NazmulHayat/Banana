# Supabase setup (Banana)

This app uses Supabase for:
- Auth (Apple + Google OAuth)
- Postgres (stores **ciphertext only**)
- Storage (stores **encrypted blobs** for photos)

## 1) Create Supabase project
- Create a new Supabase project.
- Keep the **service role key** private (never put it in the app).

## 2) Run database schema + policies
Open **SQL Editor** in Supabase and run, in order:
1. [`supabase/schema.sql`](schema.sql)
2. [`supabase/storage.sql`](storage.sql)

## 3) Create Storage bucket
Create a bucket named `private-media` (private / not public).
- You can do this in the Dashboard, or let `storage.sql` create it.

## 4) Configure Auth providers
In Supabase Dashboard:
- Authentication → Providers → enable **Google** and **Apple**
- Authentication → URL Configuration → add redirect URLs for your app scheme.

This app’s Expo scheme is `banana` (see [`app.json`](../app.json)).
So your redirect URL will be based on `banana://...` when we wire up OAuth.

## 5) Add env vars to Expo
Create `.env` locally (do not commit) with:

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

