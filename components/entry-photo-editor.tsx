import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors, Fonts, Hairline, Scrim } from "@/constants/theme";
import { getImageUrl } from "@/lib/media";
import { useEffect, useState } from "react";
import { Image } from "expo-image";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const THUMB = 64;

export interface EntryPhotoEditorProps {
  /** Storage paths already on the entry that the user is keeping. */
  paths: string[];
  /** Local URIs picked in this session, not uploaded yet. */
  localUris: string[];
  /** Cap across both lists. */
  max: number;
  /** True while the save is in flight — the whole strip goes inert. */
  disabled?: boolean;
  onRemovePath: (path: string) => void;
  onRemoveLocal: (uri: string) => void;
  onAdd: () => void;
}

/** One tile: a thumbnail with a remove affordance sitting on its corner. */
function Thumb({
  uri,
  loading,
  disabled,
  onRemove,
  label,
}: {
  uri: string | null;
  loading: boolean;
  disabled?: boolean;
  onRemove: () => void;
  label: string;
}) {
  return (
    <View style={styles.thumbWrap}>
      <View style={styles.thumb}>
        {loading || !uri ? (
          <ActivityIndicator size="small" color={Colors.ink} />
        ) : (
          <Image
            source={{ uri }}
            style={styles.thumbImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={uri}
          />
        )}
      </View>
      <Pressable
        onPress={onRemove}
        disabled={disabled}
        hitSlop={8}
        style={[styles.remove, disabled && styles.removeOff]}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${label}`}
      >
        <IconSymbol name="xmark" size={11} color={Colors.paper} />
      </Pressable>
    </View>
  );
}

/**
 * Add and remove photos while editing an entry.
 *
 * Removal here is *staged*, never immediate: nothing leaves the bucket until
 * the entry saves. Cancelling has to be a true no-op, and a photo deleted
 * before a failed save would be gone for good with the entry still pointing at
 * it — for a journal that's the unforgivable bug.
 */
export function EntryPhotoEditor({
  paths,
  localUris,
  max,
  disabled,
  onRemovePath,
  onRemoveLocal,
  onAdd,
}: EntryPhotoEditorProps) {
  // Signed URLs for the photos already on the entry, resolved once per path.
  const [urls, setUrls] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const path of paths) {
        if (cancelled) return;
        setUrls((prev) => {
          if (path in prev) return prev;
          return prev;
        });
        const url = await getImageUrl(path);
        if (cancelled) return;
        setUrls((prev) => ({ ...prev, [path]: url }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paths]);

  const total = paths.length + localUris.length;
  const canAdd = total < max && !disabled;

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>Photos</Text>
        <Text style={styles.count}>
          {total}/{max}
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        keyboardShouldPersistTaps="handled"
      >
        {paths.map((path, i) => (
          <Thumb
            key={path}
            uri={urls[path] ?? null}
            loading={!(path in urls)}
            disabled={disabled}
            onRemove={() => onRemovePath(path)}
            label={`photo ${i + 1}`}
          />
        ))}
        {localUris.map((uri, i) => (
          <Thumb
            key={uri}
            uri={uri}
            loading={false}
            disabled={disabled}
            onRemove={() => onRemoveLocal(uri)}
            label={`new photo ${i + 1}`}
          />
        ))}
        {total < max ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onAdd}
            disabled={!canAdd}
            style={[styles.addTile, !canAdd && styles.addTileOff]}
            accessibilityRole="button"
            accessibilityLabel="Add a photo"
            accessibilityState={{ disabled: !canAdd }}
          >
            <IconSymbol name="camera" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </ScrollView>
      {total === 0 ? (
        <Text style={styles.hint}>No photos on this entry.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginTop: 14 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwritingSemiBold,
  },
  count: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  strip: { gap: 10, paddingRight: 4, paddingTop: 6 },
  thumbWrap: { width: THUMB, height: THUMB },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: Colors.paper,
    borderWidth: 1,
    borderColor: Hairline.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImage: { width: "100%", height: "100%" },
  remove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Scrim.photo,
    borderWidth: 1,
    borderColor: Scrim.photoBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  removeOff: { opacity: 0.4 },
  addTile: {
    width: THUMB,
    height: THUMB,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: Hairline.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  addTileOff: { opacity: 0.4 },
  hint: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 2,
  },
});
