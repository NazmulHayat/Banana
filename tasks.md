# Aight Bet — Tasks (to App Store 1.0)

> **This file is law.** Every session: open it, do the top unchecked item, check it off, commit.
> Never start a session by browsing the app for things to fix.

**NEXT SESSION STARTS HERE →** Publish the privacy policy (`docs/privacy-policy.md`) to a public URL and update the three constants in `app/(tabs)/profile.tsx:36-38`. Then M0 is done.

**The finish line:** a polished, reliable, professional **public App Store 1.0**. We build the **mandatory** features and quality bars first (M0–M8 → beta), ship to TestFlight, then harden and launch (M9–M11). Nice-to-haves come *after* launch, slowly. One milestone in flight, ever.

---

## Operating rules (the product-management system)

1. **The distraction rule.** Notice something ugly/broken mid-task? Don't touch it. Add one line to **Nice-to-haves** below and keep going.
2. **Bug triage.** Fix now only if it breaks the core loop (sign up → track habit → write entry → see feed). Everything else → Nice-to-haves.
3. **One milestone in flight, ever.** No skipping ahead.
4. **Weekly 20-min review (Sunday).** Check off what shipped, write next session's first task at the top, prune the lists.
5. **Mandatory before optional; correctness before polish.** Build every Functional Requirement + meet every Non-Functional Requirement before beta. Aesthetic *polish* is M9, after real feedback.
6. **Dogfood daily.** Use the app on your own phone starting now.
7. **Ship gate.** Nothing is "done" until `npm run lint` and `npx tsc --noEmit` pass clean.

---

# Requirements

Two buckets: **Functional Requirements (FR)** = what the app must *do* (mandatory features). **Non-Functional Requirements (NFR)** = how *well* it must do it (mandatory quality bars). Everything else is **Nice-to-haves** (optional, post-launch). Milestones below reference these IDs.

## Functional Requirements — mandatory for 1.0

**Auth & Account**
- FR-A1 — Email signup with username + password *(built)*
- FR-A2 — Email verification *(built)*
- FR-A3 — Login *(built)*
- FR-A4 — Recovery-key generation + password reset via recovery key *(built)*
- FR-A5 — **Change password** (re-wraps master key) — verify final + tested
- FR-A6 — Sign out *(built)* — must confirm before signing out
- FR-A7 — **Account deletion (in-app)** — *Apple-required for public launch*; backend exists but has an orphan-cleanup gap to close

**Habits**
- FR-H1 — Create habit
- FR-H2 — Rename habit
- FR-H3 — Delete habit — **must confirm first**
- FR-H4 — **Reorder habits** (drag in the grid)
- FR-H5 — Toggle completion per day on the grid *(built)*

**Entries & Feed**
- FR-E1 — Create daily highlight (text) *(built)*
- FR-E2 — Attach photos to an entry *(built; not E2E-encrypted in v1, disclosed)*
- FR-E3 — **Edit entry** (reuse `components/highlight-input.tsx`)
- FR-E4 — **Delete entry** — **must confirm first** (backend + media cleanup exist)
- FR-E5 — Month-browsable feed *(built)*

**Profile & Stats**
- FR-P1 — Show username + account info; remove dead placeholders
- FR-P2 — **Stats** (streaks + totals) on the profile screen
- FR-P3 — Reveal recovery key in settings *(built)*

**Onboarding & Home**
- FR-O1 — welcome → habits → first-entry demo → app *(built; improve clarity + flow in M6)*
- FR-O2 — Home/tracker screen (`(tabs)/index`) reads clearly: today is obvious, the daily action (log habit / write entry) is the focal point, hierarchy is intentional

**Engagement**
- FR-N1 — **Habit reminders** (opt-in scheduled notifications; needs `expo-notifications`)
- FR-N2 — **Streak / milestone celebration** on completion (logic + basic celebration; finesse → M9)

**Cross-cutting UX (functional, app-wide)**
- FR-UX1 — **Confirm before every destructive action** (delete habit, delete entry, account deletion, sign out)
- FR-UX2 — Consistent interaction patterns everywhere (per NFR-4) — same feel across every screen

## Non-Functional Requirements — mandatory quality bars

- NFR-1 **Durability:** no silent data loss. Failed writes queue to AsyncStorage and retry on focus (M1). A lost write is the one unforgivable bug.
- NFR-2 **Performance:** cold open of a 30-entry month feels instant; parallel decryption, batched storage writes, in-flight request dedup (M2). Record before/after numbers.
- NFR-3 **Security / zero-knowledge:** master key never leaves device or gets logged; AAD on every encrypt/decrypt; RLS on every table; service-role key never in client. Re-read `.claude/rules/backend.md` before launch.
- NFR-4 **UX correctness & consistency:** every screen renders loading + loaded + empty/error — never a blank frame; every touchable gives physical feedback + haptics where meaningful; destructive actions confirm (FR-UX1); no raw error strings; all color/font/motion from `constants/`. (See `.claude/rules/frontend.md`.)
- NFR-5 **Accessibility:** Dynamic Type doesn't break layouts; touch targets ≥44pt; `accessibilityLabel` on icon-only buttons; contrast pass on `Colors`.
- NFR-6 **Observability:** crash/error reporting wired in production (e.g. Sentry) — can't fix what you can't see.
- NFR-7 **Store compliance:** working privacy URL; privacy nutrition labels; `ITSAppUsesNonExemptEncryption` correct; in-app account deletion (FR-A7); no debug/placeholder UI; reviewer demo account.

## v1 scope (LOCKED)

**IN:** everything in FR + NFR above. **OUT:** the Nice-to-haves list. Going public adds **polish + launch ops, not new features.** New ideas go to Nice-to-haves, not into the code.

---

# Milestones

## Phase 1 — Mandatory build → Beta (M0–M8)

### M0 — Lock scope & housekeeping
- [x] Write this tasks.md (the milestone plan)
- [x] ~~Gate `DEV_FORCE_INTRO`~~ — already `__DEV__ && true` (`app/_layout.tsx:40`); flip to `false` for normal dev routing
- [x] ~~Cut `feed-demo`~~ — investigated 2026-06-12, it's complete; keeping it
- [ ] **FR-A4 prereq / NFR-7:** publish `docs/privacy-policy.md` to a public URL, update `PRIVACY_URL`, `TERMS_URL`, `SUPPORT_EMAIL` in `app/(tabs)/profile.tsx:36-38`

### M1 — Durability: don't lose user data (NFR-1)
- [ ] On save failure in `lib/db/entries.ts` / `habit-logs.ts` / `habits.ts`: persist payload to a `pending-writes` AsyncStorage queue
- [ ] Flush queue on app focus / data-store init (`lib/data-store.tsx` init effect)
- [ ] Subtle "will sync" indicator on unsynced items
- [ ] Verify: airplane mode → save → kill app → reopen online → row appears in Supabase
- *Not building: offline-first sync or multi-device conflict resolution.*

### M2 — Performance: fix "a bit slow" (NFR-2)
- [ ] Parallelize per-row decryption (`lib/db/entries.ts:320-335`, `habit-logs.ts:166-185`) — `Promise.all`
- [ ] Batch AsyncStorage writes (`entries.ts:56-59`, `habit-logs.ts:49-51`) — `multiSet` / single write
- [ ] Dedupe in-flight requests in `lib/data-store.tsx` (~line 264) — return existing promise
- [ ] Measure cold open of a 30-entry month: `before: ___ms → after: ___ms`

### M3 — Complete the core loop: edit/delete + destructive-action UX (FR-E3, FR-E4, FR-H2, FR-H3, FR-UX1)
- [ ] FR-E3 — edit entry (reuse `highlight-input.tsx` in edit mode from the entry card)
- [ ] FR-E4 — delete entry (UI hookup; backend + media cleanup exist) **with confirm**
- [ ] FR-H2 — rename habit
- [ ] FR-H3 — delete habit **with confirm**
- [ ] **FR-UX1 — build one reusable confirmation pattern** (destructive-action dialog) and use it for all of the above + sign out
- [ ] Verify each via the feed/grid AND the Supabase row

### M4 — Habits, stats & account completeness (FR-H4, FR-P2, FR-P1, FR-A5)
- [ ] FR-H4 — reorder habits (drag in the grid; persist order)
- [ ] FR-P2 — stats: current streak + totals per habit on profile
- [ ] FR-P1 — profile shows username, dead placeholders removed
- [ ] FR-A5 — verify change-password end-to-end (re-wrap master key, then log in fresh)

### M5 — Engagement (FR-N1, FR-N2)
- [ ] FR-N1 — habit reminders: add `expo-notifications`, opt-in permission flow, schedule local notifications, settings toggle
- [ ] FR-N2 — streak/milestone celebration on completion (logic + a simple `springBouncy` celebration; full finesse deferred to M9)
- [ ] Verify reminders fire on device; no notification if permission denied

### M6 — First-impression experience + correctness sweep (FR-O1, FR-O2, NFR-4)
The two screens that decide retention come first; then one pass so the rest feels intentional. Experience/flow correctness — not aesthetic polish (that's M9).

**A. Onboarding (FR-O1) — first run must feel effortless**
- [ ] Walk the full flow (`onboarding/welcome → habits → feed-demo`) on a clean install; note every moment of confusion or friction
- [ ] Tighten copy + visual hierarchy so each step has one obvious action; clear progress/affordance between steps
- [ ] Graceful handling of skip/back/empty selections; no dead-ends

**B. Home / tracker (`(tabs)/index`, FR-O2) — the daily landing**
- [ ] "Today" is unmistakable; the primary action (log a habit / write a highlight) is the visual focal point
- [ ] Habit grid + entry CTA hierarchy reviewed; reduce clutter, strengthen what matters
- [ ] Loading/empty/first-day states feel deliberate, not half-rendered

**C. App-wide correctness sweep (NFR-4)**
- [ ] Every screen (`(tabs)/*`, `auth/*`, `onboarding/*`): loading + loaded + empty/error states, no blank frames
- [ ] Every touchable has feedback; haptics on save/toggle/complete; destructive actions all confirm (FR-UX1 coverage check)
- [ ] No raw error strings — calm on-brand messages
- [ ] Empty states: empty feed, no habits yet, first-ever day, network-down read
- [ ] Grep for stray hex/font/duration literals outside `constants/`

### M7 — Beta readiness
- [ ] Disclosure line near photo upload: "Photos are private but not yet end-to-end encrypted — coming in v1.1"
- [ ] App icon + splash final check (`app.json`), display name "Aight Bet"
- [ ] Full manual run on clean simulator + your phone: signup → onboarding → habits → entry with photo → reminder → kill app → reopen → recovery-key password reset
- [ ] Fix only what breaks that run; everything else → Nice-to-haves

### M8 — TestFlight beta ← BETA GATE
- [ ] Apple Developer account ($99/yr)
- [ ] Add `eas.json`, `eas build --platform ios` + `eas submit`
- [ ] Internal (you + 2-3 friends, 1 week), then external (10-30 people)
- [ ] Metric: "did you open it on day 3 unprompted?"
- [ ] Tag every feedback item: *polish* (→ M9), *bug* (triage), or *Nice-to-have*

---
### ↑ Do not start anything below until beta feedback is in. ↓
---

## Phase 2 — Harden & launch (M9–M11)

### M9 — Polish & UX excellence (post-beta, feedback-driven) — NFR-4 finish
- [ ] Rank beta *polish* items here, then execute
- [ ] Motion pass (transitions, save-success, streak celebration finesse, list staggers) — all via `constants/motion.ts`
- [ ] Typography & spacing rhythm audit
- [ ] Real care on empty/first-run states (illustration or warm copy)
- [ ] Dark mode pass OR an explicit "light-only for 1.0" decision (record it)

### M10 — Launch hardening (NFR-3, NFR-5, NFR-6, NFR-7, FR-A7)
- [ ] NFR-6 — crash/error reporting (Sentry) in production
- [ ] FR-A7 / NFR-7 — atomic, orphan-free in-app account deletion *(Apple-required)*
- [ ] NFR-2 stress — 100+ entry month, many habits, slow network; confirm perf holds
- [ ] Auth edge cases — duplicate signup, wrong password, lost recovery key, expired session, verify-email resend
- [ ] NFR-3 security pass — re-read `.claude/rules/backend.md`; RLS everywhere, no secrets/ciphertext logged, AAD on every encrypt
- [ ] NFR-5 accessibility pass — Dynamic Type, ≥44pt targets, labels, contrast
- [ ] NFR-7 compliance — privacy nutrition labels, encryption declaration, no debug UI, reviewer demo account

### M11 — App Store 1.0 launch
- [ ] Store listing: name, subtitle, keywords, description, support + marketing URLs
- [ ] Screenshots for required device sizes (+ optional preview video)
- [ ] Production `eas build` + `eas submit` to App Store Connect
- [ ] Submit for review; log + resolve any rejections
- [ ] Release (manual or phased) → **1.0 is live**
- [ ] Watch crash reports + reviews for one week; hotfix blockers only

---

## Nice-to-haves (build slowly, post-launch — add freely, build never until someone asks)

**Promoted to v1.1 shortlist (rank by user feedback):**
1. **Per-image E2E encryption** — schema exists (`entry_media.ciphertext_meta`); completes the zero-knowledge promise

**Parked features (explicitly out of 1.0):**
- Habit archive (soft-delete) · color/icon per habit
- Entry detail / full-screen view
- Feed search / filtering
- Export / download my data (privacy trust signal — strong v1.1 candidate)
- Habit scheduling/frequency (weekly, X-per-week)
- Stats trends/history over time (beyond streaks+totals)
- Multi-device sync conflict resolution (version column exists, unused)
- Key rotation / re-encryption flow
- Social login · Android polish (1.0 is iOS-first)
- Scrypt in worker thread (login ~1-2s on iOS)
- Recovery key export/download
