import { PaperBackground } from "@/components/ui/paper-background";
import { PressableScale } from "@/components/ui/pressable-scale";
import { ScreenHeader } from "@/components/ui/screen-header";
import {
  STREAK_TIERS,
  StreakFlame,
  daysToNextTier,
  streakTier,
} from "@/components/ui/streak-flame";
import { StreakPill } from "@/components/ui/streak-pill";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Streak preview — a __DEV__ scratchpad, never reachable in a release build.
 *
 * The flame is designed to change at 7, 30 and 100 days, which is three months
 * of real use before anyone can see whether the design works. Judging it by
 * imagination is how you ship a day-100 state nobody ever looked at.
 */

const TIER_NOTES: Record<number, string> = {
  0: "No streak. Nothing is drawn.",
  1: "Spark — his first proud little flame-sprout, sitting like a first curl of hair.",
  2: "Kindle — two licks at a week, coloured in with the highlighter.",
  3: "Blaze — three licks, a hot paper-white core, sparks landing on the page.",
  4: "Inferno — the widest fire, a smug smile, and the shades come on. The glint sweeps instead of blinking.",
};

/** The interesting values — every boundary, plus one either side of it. */
const SAMPLES = [0, 1, 3, 6, 7, 8, 15, 29, 30, 31, 60, 99, 100, 101, 365, 1000];

export default function StreakPreviewScreen() {
  const insets = useSafeAreaInsets();
  const [streak, setStreak] = useState(6);

  const tier = streakTier(streak);
  const remaining = daysToNextTier(streak);

  return (
    <PaperBackground>
      <ScreenHeader title="Streak preview" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <Text style={styles.intro}>
          Dev only. It&apos;s our own face standing in a fire that grows with
          the streak. The face only draws at 30pt and up.
        </Text>

        {/* Live control — the roll and flare only fire on an increase, so
            stepping up is the way to see the animation the app actually
            plays. */}
        {/* Big enough to actually see the character: the face only draws
            above 30pt, so judging it at pill size tells you nothing. */}
        <View style={styles.stage}>
          <StreakFlame streak={streak} size={120} />
        </View>
        <View style={styles.stage2}>
          <StreakPill streak={streak} />
        </View>

        <View style={styles.readout}>
          <Text style={styles.readoutText}>
            <Text style={styles.bold}>{streak}</Text> days · tier {tier}
            {remaining !== null ? ` · ${remaining} to next` : " · fully grown"}
          </Text>
        </View>

        <View style={styles.controls}>
          {[-10, -1, 1, 10].map((step) => (
            <PressableScale
              key={step}
              containerStyle={styles.stepSlot}
              style={styles.step}
              onPress={() => setStreak((v) => Math.max(0, v + step))}
              accessibilityLabel={`${step > 0 ? "Add" : "Remove"} ${Math.abs(step)} days`}
            >
              <Text style={styles.stepText}>
                {step > 0 ? `+${step}` : step}
              </Text>
            </PressableScale>
          ))}
        </View>

        <View style={styles.controls}>
          {STREAK_TIERS.map((t) => (
            <PressableScale
              key={t}
              containerStyle={styles.stepSlot}
              style={styles.step}
              // Land one day short, so tapping +1 shows the moment it changes.
              onPress={() => setStreak(t - 1)}
              accessibilityLabel={`Jump to the day before ${t}`}
            >
              <Text style={styles.stepText}>{t - 1}</Text>
            </PressableScale>
          ))}
        </View>
        <Text style={styles.hint}>
          Those jump to the day *before* a threshold — then tap +1 to watch it
          cross.
        </Text>

        <Text style={styles.groupLabel}>Every tier, side by side</Text>
        {[0, 1, 2, 3, 4].map((t) => {
          const sample = t === 0 ? 0 : STREAK_TIERS[t - 1];
          return (
            <View key={t} style={styles.tierRow}>
              <View style={styles.tierMark}>
                <StreakFlame streak={sample} size={44} />
              </View>
              <View style={styles.tierText}>
                <Text style={styles.tierTitle}>
                  Tier {t}
                  {t > 0 ? ` · from day ${STREAK_TIERS[t - 1]}` : ""}
                </Text>
                <Text style={styles.tierNote}>{TIER_NOTES[t]}</Text>
              </View>
            </View>
          );
        })}

        <Text style={styles.groupLabel}>The pill at every boundary</Text>
        <View style={styles.gallery}>
          {SAMPLES.map((n) => (
            <View key={n} style={styles.galleryItem}>
              <StreakPill streak={n} />
              <Text style={styles.galleryLabel}>{n}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 4,
  },
  stage: {
    alignItems: "center",
    justifyContent: "center",
    height: 150,
  },
  stage2: { alignItems: "center", paddingBottom: 14 },
  readout: { alignItems: "center", marginBottom: 16 },
  readoutText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
  bold: { fontFamily: Fonts.handwritingSemiBold, color: Colors.ink },
  controls: { flexDirection: "row", gap: 8, marginBottom: 10 },
  stepSlot: { flex: 1 },
  step: {
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.ink,
  },
  stepText: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
  hint: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 6,
  },
  groupLabel: {
    fontSize: 15,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    marginTop: 26,
    marginBottom: 6,
  },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Hairline.base,
  },
  tierMark: { width: 48, alignItems: "center" },
  tierText: { flex: 1 },
  tierTitle: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
  tierNote: {
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 2,
  },
  gallery: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    paddingTop: 6,
  },
  galleryItem: { alignItems: "center", gap: 4 },
  galleryLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
  },
});
