# Aight Bet

A zero-knowledge, end-to-end-encrypted habit tracker + daily journal. Built with Expo / React Native; Supabase (Postgres + RLS + Storage) is the only backend. The server never sees plaintext — habits, logs, and entries are encrypted client-side with a master key that never leaves the device.

## Quick start

```bash
npm install
npm start            # Expo dev server — then press i (iOS), a (Android), w (web)
```

Requires a `.env` with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_KEY`.

## Commands

```bash
npm run ios          # iOS simulator
npm run lint         # eslint (must pass clean)
npx tsc --noEmit     # type check (must pass clean)
npx tsx tests/crypto.test.ts   # pure crypto unit tests (no network)
npx tsx tests/e2e.test.ts      # integration vs live Supabase (needs .env)
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
