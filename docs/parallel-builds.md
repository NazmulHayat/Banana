# Parallel builds — worktree subagents

How to build several independent pieces of a feature concurrently, each in its own isolated git worktree, while you stay the single "commander" in one chat session. Powered by the `.claude/agents/parallel-builder.md` subagent.

## When to use it (and when not to)

**Good fit:** a single milestone has 2–4 slices that *don't touch the same files* — e.g. a screen + a `lib/db` function + a UI primitive. They build in parallel, verify independently, then merge.

**Bad fit / don't bother:**
- Slices that edit the same file → they'll conflict; just do them sequentially.
- One small change → the worktree setup overhead isn't worth it.
- Anything that crosses milestones → **`tasks.md` is law: one milestone in flight.** Parallelize *within* the current milestone only.

## Prerequisites (read this — two real gotchas)

1. **Commit your config first.** Worktrees branch from the **default branch's committed state**, not your uncommitted working tree. So `CLAUDE.md`, `.claude/rules/`, `.claude/agents/parallel-builder.md`, and any code the workers depend on must be **committed to `main`** before you dispatch — otherwise the workers won't see them.
2. **`node_modules` isn't in a fresh worktree** (it's gitignored). The agent is told to symlink the parent repo's `node_modules` (fast) or `npm install` (slow) before linting. If symlinking misbehaves on your machine, that's the first thing to check when a worker reports a broken gate.

## The recipe

In your main session, ask for a parallel build in three beats. The main thread acts as **Lead Architect**: it writes one shared contract, dispatches the workers, then integrates.

1. **Contract first.** The Lead writes the exact shapes everything must align to — function signatures, type/DTO shapes, prop interfaces, file paths — into `.claude/tasks/<feature>-spec.md` (gitignored scratch). This is what keeps independently-built slices snapping together.
2. **Dispatch workers concurrently.** The Lead spawns one `parallel-builder` per slice (each auto-isolated in a worktree via the agent's `isolation: worktree`). Each worker builds only its assigned files, follows `.claude/rules/`, and must pass `npm run lint` + `npx tsc --noEmit` before finishing.
3. **Integrate.** Once all workers are green, the Lead pulls the branches together, runs the gate once more on the combined result, shows you the **full integrated diff**, and merges only on your approval. (Your chosen policy — never auto-merge.)

## Example prompt (real, from tasks.md M3)

M3 has independent slices — edit/delete entry, rename/delete habit, and the shared confirm dialog. Paste something like:

```
We're implementing tasks.md M3 (edit/delete entries + rename/delete habit +
destructive-action confirm UX). Act as Lead Architect, dispatch parallel-builder
agents within this milestone only.

1. FIRST: write the shared contract to .claude/tasks/m3-spec.md — the
   ConfirmDialog component's prop interface, the lib/db signatures for delete/
   rename, and which files each slice owns (no overlaps).

2. THEN: spawn 3 parallel-builder agents concurrently, each in its own worktree:
   - Agent 1 (UI primitive): build the reusable ConfirmDialog in components/ui/,
     per .claude/rules/frontend.md (states, haptics, tokens-only). Owns only that file.
   - Agent 2 (entries): wire edit + delete entry in the feed/tracker entry card,
     reusing highlight-input.tsx; call existing lib/db/entries.ts. Confirm-on-delete
     per the contract.
   - Agent 3 (habits): rename + delete habit in habit management, confirm-on-delete.

3. THEN: once all three pass lint + tsc, integrate the branches, run the gate on the
   combined result, show me the full diff, and merge only on my OK.
```

## Why this beats three terminals

You stay in **one** session as commander. The Lead writes the spec once (so slices align), spawns the workers, enforces the verify gate, and pulls pre-tested code back together — instead of you hand-driving three windows and merging by hand.

---
See also: `.claude/agents/parallel-builder.md` (the worker's directive), `tasks.md` (what's in-flight), `.claude/rules/` (the rules workers obey).
