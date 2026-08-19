# Aight Bet

A zero-knowledge, end-to-end-encrypted habit tracker + daily journal. Built with Expo / React Native; Supabase (Postgres + RLS + Storage) is the only backend. The server never sees plaintext — habits, logs, and entries are encrypted client-side with a master key that never leaves the device.

## Quick start

```bash
npm install
npm start            # Expo dev server — then press i (iOS), a (Android), w (web)
```

Requires a `.env` with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_KEY`.

## Run on your phone

```bash
npx expo start          # or: npm start
```

Install **Expo Go** ([iOS](https://apps.apple.com/app/expo-go/id982107779) ·
[Android](https://play.google.com/store/apps/details?id=host.exp.exponent)), then scan the QR in
the terminal — iOS with the Camera app, Android from inside Expo Go. Phone and Mac must be on the
same Wi-Fi.

If the QR times out (guest Wi-Fi, client isolation, VPN, or a different network):

```bash
npm run start:tunnel    # routes through ngrok — works from anywhere, a little slower
npm run start:clear     # if the bundle is stale or behaving oddly
```

Two things don't work in Expo Go and need a native build (`npm run ios:device`, or an EAS
`preview` build from `eas.json`):

- **The daily reminder** (`lib/reminder.ts`) — `expo-notifications` isn't fully supported in Expo
  Go on SDK 54.
- **`aightbet://` deep links** — Expo Go serves `exp://<lan-ip>:8081/--/…` instead, so the
  password-reset email won't route back into the app. To test that flow over Expo Go, add
  `exp://192.168.0.142:8081/--/auth/reset-password` (your LAN IP) to Supabase → Authentication →
  URL Configuration → Redirect URLs.

## Commands

```bash
npm start                  # Metro dev server (Expo Go)
npm run start:tunnel       # Metro over an ngrok tunnel
npm run start:clear        # Metro with a cleared cache
npm run ios                # iOS simulator
npm run android            # Android emulator
npm run ios:device         # native build onto a connected iPhone (Xcode + Apple ID)
npm run build:preview:ios  # EAS cloud build, profiles in eas.json

npm run lint               # eslint (must pass clean)
npx tsc --noEmit           # type check (must pass clean)
npm test                   # all offline suites
npx tsx tests/e2e.test.ts  # integration vs live Supabase (needs .env.local)
```

## Project layout

```
app/         expo-router screens — (tabs)/ · auth/ · onboarding/
components/  shared UI; components/ui/ = primitives
constants/   theme.ts (Colors, Fonts), motion.ts — the only source of styling tokens
lib/crypto/  E2E primitives (keyring, payload+AAD, buckets)
lib/db/      data layer (entries, habits, habit-logs): cache + crypto + Supabase
supabase/migrations/   SQL schema + Row Level Security (the backend)
tests/       tsx test harness
docs/        long-form docs (data flow, privacy policy)
```

## Documentation

- **[PRODUCT.md](./PRODUCT.md)** — the north star: what we're building, who for, and the full vision (analytics, per-habit deep-dive, privacy-first AI).
- **[tasks.md](./tasks.md)** — the milestone plan to App Store 1.0. *This file is law:* one milestone in flight, mandatory before optional.
- **[CLAUDE.md](./CLAUDE.md)** — engineering directives (stack, security constraints, architecture guardrails).
- **[.claude/rules/](./.claude/rules/)** — path-scoped rules: `frontend.md`, `backend.md`.
- **[docs/parallel-builds.md](./docs/parallel-builds.md)** — how to build feature slices concurrently with worktree subagents.
- **[docs/FLOW_EXPLANATION.md](./docs/FLOW_EXPLANATION.md)** — end-to-end data + crypto flow walkthrough.
- **[docs/privacy-policy.md](./docs/privacy-policy.md)** — privacy policy.
