import { Colors, Fonts, Hairline } from "@/constants/theme";
import { DailyEntry } from "@/lib/db";
import {
  determineLayout,
  ImageDimension,
  LayoutType,
} from "@/lib/layout-algorithm";
import { getImageUrl } from "@/lib/media";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { IconButton } from "./ui/icon-button";
import { IconSymbol } from "./ui/icon-symbol";
import { ImageViewer } from "./ui/image-viewer";
import { PaperCard } from "./ui/paper-card";

interface FeedEntryCardProps {
  entry: DailyEntry;
  /** Optional small timestamp shown in the top-right of the card. */
  timeLabel?: string;
  /** Show the edit pencil; called when tapped. */
  onEdit?: (entry: DailyEntry) => void;
  /** Show the delete affordance; called when tapped. */
  onDelete?: (entry: DailyEntry) => void;
}

interface ResolvedImage {
  path: string;
  /** null when the signed URL couldn't be minted — the tile becomes a retry. */
  url: string | null;
  dim: ImageDimension;
}

/** Fallback size for a photo we couldn't measure (or couldn't reach at all). */
const FALLBACK_DIM: ImageDimension = { width: 400, height: 300 };

/** Top row: optional timestamp on the left, edit/delete actions on the right. */
function CardHeader({
  entry,
  timeLabel,
  onEdit,
  onDelete,
}: {
  entry: DailyEntry;
  timeLabel?: string;
  onEdit?: (entry: DailyEntry) => void;
  onDelete?: (entry: DailyEntry) => void;
}) {
  const showActions = Boolean(onEdit || onDelete);
  if (!timeLabel && !showActions) return null;
  return (
    <View style={styles.header}>
      {timeLabel ? (
        <Text style={styles.timeLabel}>{timeLabel}</Text>
      ) : (
        <View />
      )}
      {showActions && (
        <View style={styles.actions}>
          {onEdit && (
            <IconButton
              size={32}
              onPress={() => onEdit(entry)}
              accessibilityLabel="Edit highlight"
              accessibilityHint={
                timeLabel ? `Saved at ${timeLabel}` : undefined
              }
            >
              <IconSymbol name="pencil" size={17} color={Colors.textSecondary} />
            </IconButton>
          )}
          {onDelete && (
            <IconButton
              size={32}
              onPress={() => onDelete(entry)}
              accessibilityLabel="Delete highlight"
              accessibilityHint={
                timeLabel ? `Saved at ${timeLabel}` : undefined
              }
            >
              <IconSymbol name="trash" size={16} color={Colors.textSecondary} />
            </IconButton>
          )}
        </View>
      )}
    </View>
  );
}

export function FeedEntryCard({
  entry,
  timeLabel,
  onEdit,
  onDelete,
}: FeedEntryCardProps) {
  const [resolved, setResolved] = useState<ResolvedImage[]>([]);
  const [layoutDecision, setLayoutDecision] = useState<{
    layoutType: LayoutType;
    imageCount: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  // Bumped by the retry tile: signed URLs are only cached on success, so a
  // re-run asks the server again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const paths = entry.mediaPaths ?? [];
      if (paths.length === 0) {
        setResolved([]);
        setLayoutDecision({ layoutType: "TEXT_ONLY", imageCount: 0 });
        setLoading(false);
        return;
      }

      // Resolve signed URLs for each path, then fetch dimensions
      const items: ResolvedImage[] = [];
      for (const path of paths) {
        const url = await getImageUrl(path);
        // A photo whose URL failed used to vanish, so a photo-only entry
        // rendered as an empty card. Keep its place and offer a retry.
        if (!url) {
          items.push({ path, url: null, dim: FALLBACK_DIM });
          continue;
        }
        const dim = await new Promise<ImageDimension>((resolveDim) => {
          Image.getSize(
            url,
            (width, height) => resolveDim({ width, height }),
            () => resolveDim(FALLBACK_DIM),
          );
        });
        items.push({ path, url, dim });
      }

      if (cancelled) return;
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

    setLoading(true);
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
        />
        {entry.text ? <Text style={styles.text}>{entry.text}</Text> : null}
        {(entry.mediaPaths ?? []).length > 0 && (
          <View style={styles.loadingImages}>
            <ActivityIndicator size="small" color={Colors.textSecondary} />
          </View>
        )}
      </PaperCard>
    );
  }

  const { layoutType, imageCount } = layoutDecision;

  return (
    <>
      <PaperCard style={styles.card}>
        <CardHeader
          entry={entry}
          timeLabel={timeLabel}
          onEdit={onEdit}
          onDelete={onDelete}
        />
        {layoutType === "TEXT_ONLY" && (
          <>
            {entry.text ? <Text style={styles.text}>{entry.text}</Text> : null}
          </>
        )}
        {layoutType === "TEXT_WITH_IMAGES" && (
          <TextWithImagesLayout
            entry={entry}
            resolved={resolved}
            imageCount={imageCount}
            onImagePress={(url) => setViewerUri(url)}
            onRetry={() => setAttempt((a) => a + 1)}
          />
        )}
      </PaperCard>
      <ImageViewer
        uri={viewerUri}
        visible={viewerUri !== null}
        onClose={() => setViewerUri(null)}
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
  onImagePress: (url: string) => void;
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

  return (
    <>
      {entry.text ? <Text style={styles.text}>{entry.text}</Text> : null}
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
              onPress={() => onImagePress(url)}
              style={{ marginRight, marginBottom }}
              accessibilityRole="button"
              accessibilityLabel={`Photo ${index + 1} of ${imageCount}`}
              accessibilityHint="Opens the photo full screen"
            >
              <Image
                source={{ uri: url }}
                style={[
                  styles.image,
                  { width: imageWidth, height: imageHeight },
                ]}
                resizeMode="cover"
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
    marginBottom: 6,
    marginTop: -4,
    marginRight: -4,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
  },
  timeLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    letterSpacing: 0.3,
    opacity: 0.85,
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
