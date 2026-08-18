# PRODUCT.md — Aight Bet

> **The north star.** This file is *what* we're building and *why*. `tasks.md` decides *when* (and is law — vision here does not authorize work; only the task list does). `CLAUDE.md` + `.claude/rules/` decide *how*.

## One line

**Aight Bet is a private, end-to-end-encrypted habit tracker and daily journal — a calm place to commit to who you're becoming, where everything you write is yours alone.**

The name says it: *"aight, bet"* — a quiet agreement with yourself. You make the bet, you show up, the app remembers. Streaks punish you for stopping; stamps reward you for having done it. No social pressure, no company reading your diary.

## What it is

Two intertwined daily rituals in one paper-feeling app:

1. **Habit grid** — mark off the habits you're building, day by day. A tactile, glanceable record of showing up.
2. **Daily highlights (journal)** — one or more short entries a day, optionally with photos. A month-browsable feed of your life.

Both are **encrypted on your device** before they ever touch the server. The backend (Supabase) stores only ciphertext and HMAC-bucketed dates — it cannot read your habits, your words, or even *which days* you wrote. Your master key is derived from your password and never leaves the phone; a one-time recovery key is your only backup. This is **zero-knowledge by design**, not as a marketing checkbox.

The aesthetic is deliberate: warm paper, a dot grid, near-black ink, a single soft-orange accent, and a handwriting typeface. It should feel like a well-made notebook, not a productivity dashboard — **calm, tactile, personal.**

## Who it's for

- **The private journaler** who wants to write honestly and refuses to put their inner life in a cloud that mines it. Privacy isn't a feature to them; it's the precondition.
- **The habit-builder burned out on punitive gamification** — tired of apps that turn self-improvement into a slot machine where one missed day wipes the board. They'll happily collect stamps and beat their own records; what they won't accept is being punished for stopping.
- **The reflective doer** who believes habits and journaling belong together: what you *do* and what you *notice* are two halves of the same daily check-in.
- **Younger, design-literate users** who recognize the voice ("aight, bet") and expect an app that looks and feels intentional, not corporate.

Not for: people who want public accountability, leaderboards, or a social network. That's a different product.

## Why it exists (the bet we're making)

Most habit apps optimize for engagement metrics, not for the user's actual life. Most journaling apps quietly hold the most intimate text a person writes — in plaintext, on someone else's servers. **We think the most personal software should be the most private, and the calmest.** Aight Bet is the app you trust enough to be honest in, day after day, because the trust is enforced by math, not by a privacy policy.

## The core loop (protect this above all)

```
sign up  →  pick habits  →  each day: tick habits + write a highlight  →  browse the feed
```

Everything in the product serves this loop. Anything that doesn't make showing up daily easier, calmer, or more honest is a distraction (see tasks.md's Nice-to-haves).

## Principles

1. **Privacy is the product.** Zero-knowledge is non-negotiable. If a feature requires the server to read user content, it must be on-device or explicit opt-in — never silent.
2. **Calm over engagement.** No dark patterns, no guilt mechanics, no manufactured urgency.
3. **Gamify against your past self — permanently, never punitively.** Streaks punish you for stopping; stamps reward you for having done it. Every mechanic is additive-only: a stamp earned is never revoked, a record is beaten or tied but never taken away. **Nothing can ever be lost.**
4. **Tactile and personal.** It should feel like *your* notebook. Design fidelity is a core value, not polish.
5. **Honest by default.** Plain language, clear disclosures (e.g. photos aren't E2E-encrypted in v1, and we say so).
6. **Daily, not addictive.** Success = you opened it on day 3 because you wanted to, not because we nagged you.

---

# The full vision (ideas by horizon)

Grouped by horizon. **Only `tasks.md` authorizes building any of this** — this section is the dream, not a to-do list. Current shipping scope lives in tasks.md's Functional/Non-Functional Requirements.

## Now — v1 (shipping to App Store 1.0)
Email auth + recovery key · E2E-encrypted habits/logs/entries · habit grid · create/rename/delete/**reorder** habits · daily highlights with photos · month-browsable feed · **edit/delete** entries · **habit reminders** · onboarding · profile + change password. Plus the full **insights surface, free** — calendar heatmap, progress trends, streak-vs-record, per-habit deep-dive, journal stats, habit comparison, consistency score, correlations — and **calm gamification**: perfect days, a personal-records board, and permanent stamps. *(See tasks.md FR/NFR for the authoritative list.)*

## Next — post-launch, feedback-ranked
- **Per-image E2E encryption** — completes the zero-knowledge promise (schema already exists).
- **Entry detail / full-screen view** and **feed search/filter** — once there's enough history to navigate.
- **Export / download my data** — a privacy app should make leaving trivial. A trust signal.
- **Habit archive (soft-delete), color/icon per habit, scheduling/frequency** (weekly, X-per-week).

## Later — the ambitious vision

*(Analytics & insights and the individual-habit deep-dive graduated out of this section — they ship free in 1.0, above. Still ahead: mood tracking, and a weekly "chapter" recap of your month in habits and highlights.)*

### 🤖 AI suggestions & reflection (privacy-first)
The big one — and the hardest, *because* we're zero-knowledge:
- **Habit suggestions** tuned to what you're already building and where you fall off.
- **Journal insights & reflection prompts** — gentle patterns surfaced from your own entries ("you've mentioned feeling tired three Mondays running").
- **Weekly/monthly AI summaries** — a warm recap of your month in habits and highlights.
- **Smart reminders** — nudges timed to when you actually tend to log, not a fixed alarm.

**The constraint that shapes all of it:** the server can't read plaintext, so AI can't run naively in the cloud on user data. Our path:
1. **On-device first** — run inference locally (Apple on-device models / a small bundled model) so encrypted data is decrypted only in memory on the user's phone. Default, no trust trade-off.
2. **Opt-in cloud AI** — for heavier features, an *explicit, per-feature, revocable* opt-in that decrypts selected content to a trusted model with a clear disclosure. Off by default. The user always chooses to trade zero-knowledge for capability, feature by feature — we never make that choice for them.

This is the differentiator: **AI that respects the vault.** Most "AI journal" apps achieve intelligence by reading everything. We intend to be the one that doesn't.

### 🌱 Further out
Multi-device sync (conflict resolution; version column already exists) · key rotation / re-encryption · Android parity (1.0 is iOS-first) · richer media · themes / dark mode.

---

## How this relates to the other docs
- **`tasks.md`** — the only source of *what we build next*. Vision here is gated behind it. *(This file is law.)*
- **`CLAUDE.md`** + **`.claude/rules/`** — engineering directives and path-scoped rules.
- **`docs/FLOW_EXPLANATION.md`** — how the data + crypto actually flow today.
