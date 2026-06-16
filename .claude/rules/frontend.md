# Frontend rules — `app/`, `components/`, `constants/`

Scope: expo-router screens (`app/`), shared components (`components/`, with `components/ui/` as primitives), and design tokens (`constants/`).

The aesthetic is a deliberate **paper journal** — warm `#fbf8e9` paper, dot grid, near-black `#1A1A1A` ink, ShantellSans handwriting, one orange accent (`#FFB380`). Calm, tactile, minimal. Protect it; it's the product's whole feel.

## Design tokens — the only source of truth

- **Colors** — `Colors` from `@/constants/theme`. Never a hex literal in a component (one exception: the low-alpha `rgba(26,26,26,…)` hairline borders already in use). Need a new color → add it to `theme.ts`.
- **Fonts** — `Fonts` from `@/constants/theme`: `handwriting`, `handwritingMedium` (500), `handwritingSemiBold` (600).
  - Custom fonts can't synthesize weight on iOS, so for bold text set `fontFamily: Fonts.handwritingSemiBold`, **not** `fontWeight: '600'` alone.
  - Every user-facing `Text` uses a `Fonts.*` family.
- **Motion** — `Motion` from `@/constants/motion`: `fast` (150, press states), `base` (250), `slow` (350), `spring`, `springBouncy`, `stagger`. Never hardcode a duration or spring config; new timing → add a token.
- **Spacing** — multiples of 2/4 in `StyleSheet.create` at the bottom of the file. Match the rhythm of the file you're in.

## Components — reuse, don't recreate

- A surface/card → **`PaperCard`**.
- A tappable thing that should feel physical → **`PressableScale`** (or **`IconButton`** for icons). Both use a single native-driver spring — don't roll your own mixed-driver `Animated.parallel`, it breaks gesture detection.
- A loading placeholder → **`Skeleton`**. A full-screen image → **`ImageViewer`**.
- Check `components/ui/` and `components/` before building any element. Extending a primitive beats forking it.
- Components are typed function components with an explicit `interface <Name>Props` (props documented with `/** */`, like `PressableScale`). No default exports except route files (expo-router requires them for screens).
- **React Compiler is on** — write straightforward render code; don't add `useMemo` / `useCallback` / `React.memo` purely for performance. Existing memoization (`data-store.tsx`) is intentional and stays.

## Interactive states — every touchable, every time

- Tappables must give physical feedback — wrap in `PressableScale` / `IconButton` (scale-on-press, default 0.97), or set `activeOpacity={0.85}` on a `TouchableOpacity` (the established value — see `feed-entry-card.tsx`). No bare `onPress` with zero visual response.
- Pair meaningful actions (save, toggle habit, complete) with `expo-haptics` — that's why `HapticTab` and `springBouncy` exist. Animate down on `onPressIn`, settle on `onPressOut`.
- Respect `disabled` — pass it to the Pressable **and** reflect it visually (reduced opacity). Never leave a dead-looking-but-live control.

## Async states — loading and error are not optional

Any view that loads data or media renders **three** states, never a blank frame:

1. **Loading** — `Skeleton`, or an `ActivityIndicator` with `color={Colors.textSecondary}`. Reference `feed-entry-card.tsx`: show the text immediately, spinner only the images until dimensions resolve. Show whatever you already have; don't gate the whole card on the slowest piece.
2. **Loaded** — the content.
3. **Empty / error** — a calm, on-brand message in `Colors.textSecondary` + handwriting font. Never surface a raw error string or a red crash. Image failures fall back gracefully (`Image.getSize` → default dims), they don't break layout.

- Data comes from `useDataStore()` and `useAuth()` — read the `*Loading` / `*Ready` flags to pick the state. Screens never call `supabase` or `lib/db` directly; go through the store. Optimistic update on action, then persist.
- Async effects that set state must guard against unmount with a `cancelled` flag and return a cleanup (see `feed-entry-card.tsx`). No "setState after unmount" warnings.

## Screens (`app/`)

- File-based routing, typed routes on — navigate with typed `router.push` / `<Link>`; don't fight the generated types.
- Route groups `(tabs)`, `auth/`, `onboarding/` each have a `_layout.tsx`; new screens slot into the right group.
- Screens stay thin — layout + state wiring + calls into the store. Non-trivial rendering becomes a component in `components/`. Heavy helpers (layout math like `lib/layout-algorithm.ts`) live in `lib/`, not inline.
- Respect safe areas (`react-native-safe-area-context`) and the existing page padding (20pt horizontal) so cards align with the feed.

## Polish discipline

Visual polish is **post-beta** (per tasks.md). Match the existing design system exactly; don't redesign or restyle working screens mid-task. A visual nitpick noticed in passing → one line on the tasks.md **Nice-to-haves** list, then keep going.
