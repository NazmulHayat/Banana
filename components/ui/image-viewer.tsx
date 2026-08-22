import { Colors, Scrim } from "@/constants/theme";
import { Image as ExpoImage } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconSymbol } from "./icon-symbol";

interface ImageViewerProps {
  /** Photos to page through, in the order they appear on the card. */
  uris: string[];
  /** Which photo opens first. Clamped into range. */
  initialIndex?: number;
  visible: boolean;
  onClose: () => void;
}

interface ZoomablePageProps {
  uri: string;
  /** Page size — one full screen per photo, so paging lands on a photo. */
  width: number;
  height: number;
  /** Only the photo on screen keeps its zoom; the rest snap back to 1x. */
  isActive: boolean;
  /** Lifted so the pager can stop scrolling while a photo is zoomed in. */
  onZoomChange: (zoomed: boolean) => void;
  onClose: () => void;
  label: string;
}

const AnimatedImage = Animated.createAnimatedComponent(ExpoImage);

/** Anything above this counts as zoomed — pinch never settles exactly on 1. */
const ZOOM_EPSILON = 1.01;
const MAX_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;

/**
 * One photo in the pager: pinch, pan and double-tap to zoom, tap to close.
 * Each page owns its own zoom state so paging away from a zoomed photo and
 * back doesn't hand the next one a stale transform.
 */
function ZoomablePage({
  uri,
  width,
  height,
  isActive,
  onZoomChange,
  onClose,
  label,
}: ZoomablePageProps) {
  const [naturalDim, setNaturalDim] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [zoomed, setZoomed] = useState(false);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;
    Image.getSize(
      uri,
      (w, h) => {
        if (!cancelled) setNaturalDim({ width: w, height: h });
      },
      // Unmeasurable photo falls back to screen size rather than breaking layout.
      () => {
        if (!cancelled) setNaturalDim({ width, height });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uri, width, height]);

  // A page scrolled off screen returns to 1x, so coming back to it is predictable.
  useEffect(() => {
    if (isActive) return;
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    setZoomed(false);
    // useSharedValue refs are stable across renders; listing them here
    // satisfies exhaustive-deps without changing when this runs.
  }, [
    isActive,
    scale,
    savedScale,
    translateX,
    translateY,
    savedTranslateX,
    savedTranslateY,
  ]);

  function applyZoomed(next: boolean) {
    setZoomed(next);
    onZoomChange(next);
  }

  const pinch = Gesture.Pinch()
    .onStart(() => {
      // Claim the gesture immediately so the pager doesn't scroll mid-pinch.
      runOnJS(applyZoomed)(true);
    })
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(savedScale.value * e.scale, MAX_ZOOM));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= ZOOM_EPSILON) {
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        runOnJS(applyZoomed)(false);
      }
    });

  // Only enabled while zoomed: at 1x a horizontal drag belongs to the pager,
  // and an always-on Pan would swallow the swipe before the list ever saw it.
  const pan = Gesture.Pan()
    .enabled(zoomed)
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        runOnJS(applyZoomed)(false);
      } else {
        scale.value = withTiming(DOUBLE_TAP_ZOOM);
        savedScale.value = DOUBLE_TAP_ZOOM;
        runOnJS(applyZoomed)(true);
      }
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .requireExternalGestureToFail(doubleTap)
    .onEnd(() => {
      if (scale.value <= ZOOM_EPSILON) {
        runOnJS(onClose)();
      }
    });

  const composed = Gesture.Race(
    Gesture.Simultaneous(pinch, pan),
    Gesture.Exclusive(doubleTap, singleTap),
  );

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // Fit the photo inside the page without cropping it.
  const aspectRatio = naturalDim
    ? naturalDim.width / naturalDim.height
    : width / height;
  const fitsByWidth = aspectRatio >= width / height;
  const finalWidth = fitsByWidth ? width : height * aspectRatio;
  const finalHeight = fitsByWidth ? width / aspectRatio : height;

  return (
    <View style={{ width, height }}>
      <GestureDetector gesture={composed}>
        <Animated.View style={styles.page}>
          <AnimatedImage
            // `cacheKey` is the uri here: viewer sources are already full
            // signed URLs handed down per photo, and the pager remounts pages
            // by index, so the path isn't available. The feed's thumbnail
            // cache is what carries the repeat-view win.
            source={{ uri }}
            style={[{ width: finalWidth, height: finalHeight }, imageStyle]}
            contentFit="contain"
            cachePolicy="memory-disk"
            recyclingKey={uri}
            transition={120}
            accessibilityRole="image"
            accessibilityLabel={label}
            accessibilityHint="Double tap to zoom, tap once to close"
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * Full-screen photo viewer. Opens on the photo that was tapped and pages
 * horizontally through the rest of the entry's photos.
 */
export function ImageViewer({
  uris,
  initialIndex = 0,
  visible,
  onClose,
}: ImageViewerProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

  const lastIndex = Math.max(uris.length - 1, 0);
  const start = Math.min(Math.max(initialIndex, 0), lastIndex);
  const [index, setIndex] = useState(start);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  // Every open starts on the tapped photo, at 1x, scrollable again.
  useEffect(() => {
    if (!visible) return;
    setIndex(start);
    setScrollEnabled(true);
  }, [visible, start]);

  if (uris.length === 0) return null;

  function handleMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
    setIndex(Math.min(Math.max(next, 0), lastIndex));
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar style="light" hidden />
      <GestureHandlerRootView style={styles.root}>
        {/* The viewer covers everything — hide the page behind it from
            VoiceOver so swiping can't wander off the photo. */}
        <View style={styles.backdrop} accessibilityViewIsModal>
          <FlatList
            // Remounting per open is what makes initialScrollIndex land on the
            // tapped photo; it only applies on mount.
            key={visible ? `open-${start}` : "closed"}
            data={uris}
            keyExtractor={(uri, i) => `${i}:${uri}`}
            horizontal
            pagingEnabled
            scrollEnabled={scrollEnabled}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={start}
            getItemLayout={(_, i) => ({
              length: screenWidth,
              offset: screenWidth * i,
              index: i,
            })}
            onMomentumScrollEnd={handleMomentumEnd}
            renderItem={({ item, index: i }) => (
              <ZoomablePage
                uri={item}
                width={screenWidth}
                height={screenHeight}
                isActive={i === index}
                onZoomChange={(zoomed) => setScrollEnabled(!zoomed)}
                onClose={onClose}
                label={
                  uris.length > 1
                    ? `Photo ${i + 1} of ${uris.length}`
                    : "Attached photo"
                }
              />
            )}
          />
          {uris.length > 1 ? (
            <View
              style={[styles.dots, { bottom: insets.bottom + 24 }]}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {uris.map((uri, i) => (
                <View
                  key={`${i}:${uri}`}
                  style={[styles.dot, i === index ? styles.dotActive : null]}
                />
              ))}
            </View>
          ) : null}
          <Pressable
            onPress={onClose}
            style={[styles.closeButton, { top: insets.top + 12 }]}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
          >
            <View style={styles.closeButtonInner}>
              <IconSymbol name="xmark" size={20} color={Colors.paper} />
            </View>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: Colors.blackout,
    justifyContent: "center",
    alignItems: "center",
  },
  page: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  dots: {
    position: "absolute",
    flexDirection: "row",
    alignSelf: "center",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Scrim.photoBorder,
  },
  dotActive: {
    backgroundColor: Colors.paper,
  },
  closeButton: {
    position: "absolute",
    right: 16,
  },

  closeButtonInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Scrim.photo,
    borderWidth: 1,
    borderColor: Scrim.photoBorder,
    justifyContent: "center",
    alignItems: "center",
  },
});
