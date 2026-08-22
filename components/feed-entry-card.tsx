import { Colors, Fonts, Hairline } from "@/constants/theme";
import { DailyEntry } from "@/lib/db";
import {
  determineLayout,
  ImageDimension,
  LayoutType,
} from "@/lib/layout-algorithm";
import type { SavedPlace } from "@/lib/db";
import { resolvePlaceHeading } from "@/lib/location";
import { getImageUrls, thumbPathFor } from "@/lib/media";
import { useEffect, useState } from "react";
import { Image } from "expo-image";
import {
  ActivityIndicator,
  Image as RNImage,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { IconButton } from "./ui/icon-button";
import { IconSymbol } from "./ui/icon-symbol";
import { ImageViewer } from "./ui/image-viewer";
import { PaperCard } from "./ui/paper-card";
import { PressableScale } from "./ui/pressable-scale";

/** Lines a long entry collapses to before "Read more" is offered. */
const COLLAPSED_LINES = 6;

/**
 * An entry's body text, collapsed behind "Read more" once it runs long.
 *
 * An entry can be 500 characters, which is tall enough to push every other
 * card off the screen — the feed stops being scannable exactly when someone
 * has been writing properly. Short entries never show the control.
 */
function EntryText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  // Real line count of the UNCLAMPED text. Null until measured.
  const [fullLines, setFullLines] = useState<number | null>(null);

  return (
    <View>
      <Text
        style={styles.text}
        numberOfLines={expanded ? undefined : COLLAPSED_LINES}
      >
        {text}
      </Text>
      {/* Measuring twin: a clamped Text reports its post-truncation lines, so
          the visible copy can't answer "did this overflow?" on its own. This
          one is unclamped, invisible, out of flow, and unmounts the moment it
          has produced a number. */}
      {fullLines === null && (
        <Text
          style={[styles.text, styles.measureTwin]}
          onTextLayout={(event) => setFullLines(event.nativeEvent.lines.length)}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {text}
        </Text>
      )}
      {fullLines !== null && fullLines > COLLAPSED_LINES && (
        <PressableScale
          onPress={() => setExpanded((prev) => !prev)}
          hitSlop={10}
          accessibilityLabel={expanded ? "Show less" : "Read more"}
        >
          <Text style={styles.readMore}>
            {expanded ? "Show less" : "Read more"}
          </Text>
        </PressableScale>
      )}
    </View>
  );
}

interface FeedEntryCardProps {
  entry: DailyEntry;
  /** Small timestamp in the card's top-left — each entry has its own. */
  timeLabel?: string;
  /** Show the edit pencil; called when tapped. */
  onEdit?: (entry: DailyEntry) => void;
  /** Show the delete affordance; called when tapped. */
  onDelete?: (entry: DailyEntry) => void;
  /** Tapping the place tag. Omit to render the tag as plain, untappable text. */
  onEditPlace?: (entry: DailyEntry) => void;
  /**
   * The user's saved place names. The tag is resolved against these at render
   * time, so renaming a place re-labels every entry there at once.
   */
  savedPlaces?: SavedPlace[];
}

interface ResolvedImage {
  path: string;
  /** null when the signed URL couldn't be minted — the tile becomes a retry. */
  url: string | null;
  /** Small derivative for the grid; falls back to `url` when there isn't one. */
  thumbUrl: string | null;
  dim: ImageDimension;
}

/** Fallback size for a photo we couldn't measure (or couldn't reach at all). */
const FALLBACK_DIM: ImageDimension = { width: 400, height: 300 };

// ----------------------------------------------------------------------------
// Resolution cache
// ----------------------------------------------------------------------------
// Swiping months unmounts every card and mounts a new set, so without this the
// whole resolve ran again on the way back: URLs re-read, legacy photos
// re-measured over the network, and a spinner flashed over images already
// sitting in expo-image's disk cache. Module scope on purpose — it has to
// outlive the component, and it holds only URLs and sizes, never image bytes.
const resolvedCache = new Map<string, ResolvedImage[]>();
/** Measured sizes for pre-`media` photos, keyed by path. Measured once, ever. */
const measuredDims = new Map<string, ImageDimension>();

/** Cache key: the entry AND its photo set, so an edit invalidates it. */
function resolutionKey(entry: DailyEntry): string {
  return `${entry.id}:${(entry.mediaPaths ?? []).join(",")}`;
}

/** Dropped on sign-out / account purge via the store's clearAll path. */
export function clearFeedImageCache(): void {
  resolvedCache.clear();
  measuredDims.clear();
}

/**
 * Last resort for entries written before dimensions were stored. This downloads
 * the file to read its header, which is exactly why nothing new relies on it.
 */
function measureRemote(url: string): Promise<ImageDimension> {
  return new Promise((resolve) => {
    RNImage.getSize(
      url,
      (width, height) => resolve({ width, height }),
      () => resolve(FALLBACK_DIM),
    );
  });
}

/**
 * The place tag. Underlined on purpose: it's the app's guess at where you were,
 * and an underline is the plainest way to say "this is editable" without adding
 * a button to every card.
 */
function PlaceTag({
  entry,
  onEditPlace,
  savedPlaces,
}: {
  entry: DailyEntry;
  onEditPlace?: (entry: DailyEntry) => void;
  savedPlaces?: SavedPlace[];
}) {
  if (!entry.place) return null;
  // The saved name wins over the one the entry was given, which is what makes
  // a rename in Manage propagate everywhere without rewriting any history.
  const heading = resolvePlaceHeading(entry.place, savedPlaces ?? []);
  const label = `@${heading}`;
  if (!onEditPlace) {
    return <Text style={styles.placeTag}>{label}</Text>;
  }
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => onEditPlace(entry)}
      style={styles.placeTagHit}
      accessibilityRole="button"
      accessibilityLabel={`Written at ${heading}`}
      accessibilityHint="Tap to rename this place"
    >
      <Text style={[styles.placeTag, styles.placeTagLink]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Top strip: time and place on the left, edit/delete on the right. */
function CardHeader({
  entry,
  timeLabel,
  onEdit,
  onDelete,
  onEditPlace,
  savedPlaces,
}: {
  entry: DailyEntry;
  timeLabel?: string;
  onEdit?: (entry: DailyEntry) => void;
  onDelete?: (entry: DailyEntry) => void;
  onEditPlace?: (entry: DailyEntry) => void;
  savedPlaces?: SavedPlace[];
}) {
  const showActions = Boolean(onEdit || onDelete);
  if (!timeLabel && !showActions && !entry.place) return null;
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        {timeLabel ? <Text style={styles.timeLabel}>{timeLabel}</Text> : null}
        <PlaceTag
          entry={entry}
          onEditPlace={onEditPlace}
          savedPlaces={savedPlaces}
        />
      </View>
      {showActions ? (
        <View style={styles.actions}>
          {onEdit && (
            <IconButton
              size={28}
              onPress={() => onEdit(entry)}
              accessibilityLabel="Edit highlight"
              accessibilityHint={
                timeLabel ? `Saved at ${timeLabel}` : undefined
              }
            >
              <IconSymbol name="pencil" size={15} color={Colors.textSecondary} />
            </IconButton>
          )}
          {onDelete && (
            <IconButton
              size={28}
              onPress={() => onDelete(entry)}
              accessibilityLabel="Delete highlight"
              accessibilityHint={
                timeLabel ? `Saved at ${timeLabel}` : undefined
              }
            >
              <IconSymbol name="trash" size={15} color={Colors.textSecondary} />
            </IconButton>
          )}
        </View>
      ) : null}
    </View>
  );
}

export function FeedEntryCard({
  entry,
  timeLabel,
  onEdit,
  onDelete,
  onEditPlace,
  savedPlaces,
}: FeedEntryCardProps) {
  // Seeded straight from the cache when we've resolved this entry before, so
  // a revisited month paints immediately instead of flashing a spinner.
  const cached = resolvedCache.get(resolutionKey(entry)) ?? null;
  const [resolved, setResolved] = useState<ResolvedImage[]>(cached ?? []);
  const [layoutDecision, setLayoutDecision] = useState<{
    layoutType: LayoutType;
    imageCount: number;
  } | null>(
    cached
      ? {
          layoutType: determineLayout(
            entry,
            cached.map((i) => i.dim),
          ).layoutType,
          imageCount: cached.length,
        }
      : null,
  );
  const [loading, setLoading] = useState(cached === null);
  // Index into `viewerUris` — the viewer opens on the tapped photo and pages.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // Bumped by the retry tile: signed URLs are only cached on success, so a
  // re-run asks the server again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const paths = entry.mediaPaths ?? [];
      // Already resolved this exact entry + photo set — nothing to fetch.
      // `attempt` is bumped only by the retry tile, which must bypass this.
      const key = resolutionKey(entry);
      const hit = attempt === 0 ? resolvedCache.get(key) : undefined;
      if (hit) {
        setResolved(hit);
        const decision = determineLayout(
          entry,
          hit.map((i) => i.dim),
        );
        setLayoutDecision({
          layoutType: decision.layoutType,
          imageCount: hit.length,
        });
        setLoading(false);
        return;
      }
      if (paths.length === 0) {
        setResolved([]);
        setLayoutDecision({ layoutType: "TEXT_ONLY", imageCount: 0 });
        setLoading(false);
        return;
      }

      // Mint every URL at once — full sizes and thumbnails together. These
      // used to run one after another, so a four-photo card paid four
      // sequential round trips before it could draw anything.
      const [fullUrls, thumbUrls] = await Promise.all([
        getImageUrls(paths),
        getImageUrls(paths.map(thumbPathFor)),
      ]);
      if (cancelled) return;

      // Dimensions come from the entry, written at upload time. Entries from
      // before that field existed are measured once, in parallel, and only
      // those.
      const known = new Map(
        (entry.media ?? []).map((m) => [m.path, m] as const),
      );
      const measured = await Promise.all(
        paths.map(async (path, i) => {
          const stored = known.get(path);
          if (stored) return { width: stored.width, height: stored.height };
          // Pre-`media` photo: measuring downloads the file, so remember it.
          const remembered = measuredDims.get(path);
          if (remembered) return remembered;
          const url = fullUrls[i];
          if (!url) return FALLBACK_DIM;
          const dim = await measureRemote(url);
          measuredDims.set(path, dim);
          return dim;
        }),
      );

      const items: ResolvedImage[] = paths.map((path, i) => ({
        path,
        // A photo whose URL failed used to vanish, so a photo-only entry
        // rendered as an empty card. Keep its place and offer a retry.
        url: fullUrls[i],
        thumbUrl: thumbUrls[i],
        dim: measured[i],
      }));

      if (cancelled) return;
      // Only cache a fully resolved set — a card that failed to mint URLs must
      // be allowed to try again on the next mount.
      if (items.every((i) => i.url !== null)) resolvedCache.set(key, items);
      setResolved(items);
      const decision = determineLayout(
        entry,
        items.map((i) => i.dim),
      );
      setLayoutDecision({
        layoutType: decision.layoutType,
        imageCount: items.length,
      });
      setLoading(false);
    }

    if (!resolvedCache.has(resolutionKey(entry)) || attempt > 0) setLoading(true);
    void load();

    return () => {
      cancelled = true;
    };
  }, [entry, attempt]);

  if (loading || !layoutDecision) {
    return (
      <PaperCard style={styles.card}>
        <CardHeader
          entry={entry}
          timeLabel={timeLabel}
          onEdit={onEdit}
          onDelete={onDelete}
          onEditPlace={onEditPlace}
          savedPlaces={savedPlaces}
        />
        {entry.text ? <EntryText text={entry.text} /> : null}
        {(entry.mediaPaths ?? []).length > 0 && (
          <View style={styles.loadingImages}>
            <ActivityIndicator size="small" color={Colors.ink} />
          </View>
        )}
      </PaperCard>
    );
  }

  const { layoutType, imageCount } = layoutDecision;
  // Only photos that actually resolved are pageable; a failed tile is a retry
  // button, not a photo, so it must not take up a slot in the viewer.
  const viewerUris = resolved.flatMap((item) => (item.url ? [item.url] : []));

  return (
    <>
      <PaperCard style={styles.card}>
        <CardHeader
          entry={entry}
          timeLabel={timeLabel}
          onEdit={onEdit}
          onDelete={onDelete}
          onEditPlace={onEditPlace}
          savedPlaces={savedPlaces}
        />
        {layoutType === "TEXT_ONLY" && (
          <>
            {entry.text ? <EntryText text={entry.text} /> : null}
          </>
        )}
        {layoutType === "TEXT_WITH_IMAGES" && (
          <TextWithImagesLayout
            entry={entry}
            resolved={resolved}
            imageCount={imageCount}
            onImagePress={(i) => setViewerIndex(i)}
            onRetry={() => setAttempt((a) => a + 1)}
          />
        )}
      </PaperCard>
      <ImageViewer
        uris={viewerUris}
        initialIndex={viewerIndex ?? 0}
        visible={viewerIndex !== null}
        onClose={() => setViewerIndex(null)}
      />
    </>
  );
}

function TextWithImagesLayout({
  entry,
  resolved,
  imageCount,
  onImagePress,
  onRetry,
}: {
  entry: DailyEntry;
  resolved: ResolvedImage[];
  imageCount: number;
  /** Index of the tapped photo among the ones that resolved. */
  onImagePress: (viewerIndex: number) => void;
  /** Ask for the signed URLs again after one couldn't be minted. */
  onRetry: () => void;
}) {
  // Page padding (20 each side from feed.tsx) + card padding (20 each side from PaperCard)
  const screenWidth = Dimensions.get("window").width;
  const contentWidth = screenWidth - 80;
  const gap = 6;

  // Single-image height cap so a tall portrait doesn't take over the screen.
  // Multi-image grids fill the full card width with square thumbnails.
  const MAX_SINGLE_HEIGHT = 320;

  // Tile position -> position in the viewer's pager. They diverge as soon as
  // one photo fails to resolve, since failed tiles aren't pageable.
  const viewerIndexByPath = new Map<string, number>();
  for (const item of resolved) {
    if (item.url) viewerIndexByPath.set(item.path, viewerIndexByPath.size);
  }

  return (
    <>
      {entry.text ? <EntryText text={entry.text} /> : null}
      <View style={[styles.imagesContainer, { width: contentWidth }]}>
        {resolved.map((item, index) => {
          const aspectRatio = item.dim.width / item.dim.height;
          let imageWidth: number;
          let imageHeight: number;

          if (imageCount === 1) {
            // Full card width; only cap vertical so tall portraits crop instead
            // of dominating the screen. Tap-to-zoom shows the full image anyway.
            imageWidth = contentWidth;
            imageHeight = Math.min(imageWidth / aspectRatio, MAX_SINGLE_HEIGHT);
          } else if (imageCount === 2) {
            imageWidth = (contentWidth - gap) / 2;
            imageHeight = imageWidth;
          } else if (imageCount === 3) {
            if (index < 2) {
              imageWidth = (contentWidth - gap) / 2;
              imageHeight = imageWidth;
            } else {
              imageWidth = contentWidth;
              imageHeight = Math.min(imageWidth / aspectRatio, 220);
            }
          } else {
            // 4+ images → 2×N square grid, each cell half card width
            imageWidth = (contentWidth - gap) / 2;
            imageHeight = imageWidth;
          }

          const marginRight =
            imageCount === 2
              ? index === 0
                ? gap
                : 0
              : imageCount === 3
                ? index < 2 && index === 0
                  ? gap
                  : 0
                : imageCount >= 4
                  ? index % 2 === 0
                    ? gap
                    : 0
                  : 0;

          const marginBottom =
            imageCount === 2
              ? 0
              : imageCount === 3
                ? index < 2
                  ? gap
                  : 0
                : imageCount >= 4
                  ? index < imageCount - 2
                    ? gap
                    : 0
                  : 0;

          if (!item.url) {
            return (
              <TouchableOpacity
                key={item.path}
                activeOpacity={0.85}
                onPress={onRetry}
                style={{ marginRight, marginBottom }}
                accessibilityRole="button"
                accessibilityLabel={`Photo ${index + 1} of ${imageCount} didn't load`}
                accessibilityHint="Tap to try loading it again"
              >
                <View
                  style={[
                    styles.image,
                    styles.imageFallback,
                    { width: imageWidth, height: imageHeight },
                  ]}
                >
                  <IconSymbol
                    name="photo"
                    size={22}
                    color={Colors.textSecondary}
                  />
                  <Text style={styles.imageFallbackText}>
                    Didn&apos;t load · tap to retry
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }

          const url = item.url;
          return (
            <TouchableOpacity
              key={item.path}
              activeOpacity={0.85}
              onPress={() => onImagePress(viewerIndexByPath.get(item.path) ?? 0)}
              style={{ marginRight, marginBottom }}
              accessibilityRole="button"
              accessibilityLabel={`Photo ${index + 1} of ${imageCount}`}
              accessibilityHint={
                viewerIndexByPath.size > 1
                  ? "Opens the photo full screen. Swipe to see the others."
                  : "Opens the photo full screen"
              }
            >
              <Image
                // The grid shows the ~25 KB thumbnail; the full image is only
                // fetched when the viewer opens.
                source={{
                  uri: item.thumbUrl ?? url,
                  // Keyed by PATH, not URL. Signed URLs rotate hourly, and
                  // expo-image caches by URL — without this every photo
                  // re-downloaded roughly every 50 minutes despite already
                  // being on disk, which defeated the whole cache.
                  cacheKey: item.thumbUrl ? thumbPathFor(item.path) : item.path,
                }}
                style={[
                  styles.image,
                  { width: imageWidth, height: imageHeight },
                ]}
                contentFit="cover"
                // Disk + memory cache: scrolling back to a card is free, and
                // so is reopening the app.
                cachePolicy="memory-disk"
                // Keyed by path so a recycled row can't briefly show the
                // previous entry's photo.
                recyclingKey={item.path}
                transition={120}
              />
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 0, marginBottom: 0 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    // Pulled up into the card's own top padding and given no bottom margin:
    // this strip is chrome, so it shouldn't cost a full row above the text.
    marginTop: -10,
    marginRight: -6,
    marginBottom: 0,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  placeTagHit: { alignSelf: "center" },
  placeTag: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    letterSpacing: 0.2,
    opacity: 0.75,
  },
  placeTagLink: {
    textDecorationLine: "underline",
    // A dotted rule reads as "provisional" rather than "link" — this is a
    // guess the app made, and you're invited to correct it.
    textDecorationStyle: "dotted",
  },
  timeLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    letterSpacing: 0.3,
    opacity: 0.75,
  },
  loadingImages: {
    marginTop: 8,
    paddingVertical: 24,
    alignItems: "center",
  },
  text: {
    fontSize: 16,
    color: Colors.ink,
    lineHeight: 24,
    fontFamily: Fonts.handwriting,
    marginBottom: 10,
  },
  // Invisible and out of flow — it exists only to be measured.
  measureTwin: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    opacity: 0,
  },
  readMore: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingSemiBold,
    marginBottom: 10,
  },
  imagesContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
    alignSelf: "center",
    justifyContent: "center",
  },
  image: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Hairline.base,
  },
  imageFallback: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 10,
    backgroundColor: Hairline.faint,
  },
  imageFallbackText: {
    fontSize: 11.5,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
  },
});
