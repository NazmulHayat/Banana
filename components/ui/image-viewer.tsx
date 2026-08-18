import { Colors, Scrim } from "@/constants/theme";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  Dimensions,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  View,
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
  uri: string | null;
  visible: boolean;
  onClose: () => void;
}

const AnimatedImage = Animated.createAnimatedComponent(Image);

export function ImageViewer({ uri, visible, onClose }: ImageViewerProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } =
    Dimensions.get("window");
  const [naturalDim, setNaturalDim] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  useEffect(() => {
    if (visible && uri) {
      Image.getSize(
        uri,
        (w, h) => setNaturalDim({ width: w, height: h }),
        () => setNaturalDim({ width: screenWidth, height: screenHeight }),
      );
    }
    if (!visible) {
      scale.value = 1;
      savedScale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
      setNaturalDim(null);
    }
    // useSharedValue refs are stable across renders; listing them here
    // satisfies exhaustive-deps without changing when this runs.
  }, [
    visible,
    uri,
    screenWidth,
    screenHeight,
    scale,
    savedScale,
    translateX,
    translateY,
    savedTranslateX,
    savedTranslateY,
  ]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(savedScale.value * e.scale, 5));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.01) {
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      }
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
      } else {
        scale.value = withTiming(2.5);
        savedScale.value = 2.5;
      }
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .requireExternalGestureToFail(doubleTap)
    .onEnd(() => {
      if (scale.value <= 1.01) {
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

  if (!uri) return null;

  const aspectRatio = naturalDim
    ? naturalDim.width / naturalDim.height
    : screenWidth / screenHeight;
  const displayWidth = screenWidth;
  const displayHeight =
    aspectRatio >= screenWidth / screenHeight
      ? screenWidth / aspectRatio
      : screenHeight;
  const finalWidth =
    aspectRatio >= screenWidth / screenHeight
      ? displayWidth
      : screenHeight * aspectRatio;
  const finalHeight =
    aspectRatio >= screenWidth / screenHeight ? displayHeight : screenHeight;

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
          <GestureDetector gesture={composed}>
            <Animated.View style={styles.imageContainer}>
              <AnimatedImage
                source={{ uri }}
                style={[
                  { width: finalWidth, height: finalHeight },
                  imageStyle,
                ]}
                resizeMode="contain"
                accessibilityRole="image"
                accessibilityLabel="Attached photo"
                accessibilityHint="Double tap to zoom, swipe down to close"
              />
            </Animated.View>
          </GestureDetector>
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
  imageContainer: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
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
