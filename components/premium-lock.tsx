import { PressableScale } from "@/components/ui/pressable-scale";
import { Colors, Fonts } from "@/constants/theme";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { StyleSheet, Text, View } from "react-native";

interface PremiumLockProps {
  /** When true, the children are frosted and the unlock CTA shows on top. */
  locked: boolean;
  /** Founder note: visual only for now — wire to billing later. */
  onUnlock: () => void;
  title?: string;
  message?: string;
  children: React.ReactNode;
}

/**
 * Wraps premium content. When locked, the content stays *visible but frosted*
 * (the conversion tease — value withheld, not hidden) with an unlock CTA. No
 * real paywall yet; `onUnlock` is the seam for billing.
 */
export function PremiumLock({
  locked,
  onUnlock,
  title = "Unlock your full analysis",
  message = "Heatmaps, trends and your story — for every habit.",
  children,
}: PremiumLockProps) {
  const handleUnlock = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onUnlock();
  };

  return (
    <View>
      <View pointerEvents={locked ? "none" : "auto"}>{children}</View>
      {locked && (
        <BlurView intensity={16} tint="light" style={StyleSheet.absoluteFill}>
          <View style={styles.cover}>
            <Text style={styles.lk}>🔓</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.msg}>{message}</Text>
            <PressableScale onPress={handleUnlock} style={styles.btn}>
              <Text style={styles.btnText}>Start free trial</Text>
            </PressableScale>
          </View>
        </BlurView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    flex: 1,
    alignItems: "center",
    paddingTop: 48,
    paddingHorizontal: 28,
    gap: 10,
  },
  lk: { fontSize: 30 },
  title: {
    fontSize: 20,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    textAlign: "center",
  },
  msg: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    textAlign: "center",
    maxWidth: 240,
    marginBottom: 4,
  },
  btn: {
    backgroundColor: Colors.accent,
    borderColor: Colors.ink,
    borderWidth: 1.5,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 22,
  },
  btnText: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
});
