import { PaperBackground } from "@/components/ui/paper-background";
import { PaperCard } from "@/components/ui/paper-card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Colors, Fonts, Hairline } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { useDataStore } from "@/lib/data-store";
import { getAllEntries, getAllHabitLogs } from "@/lib/db";
import { buildExport, exportFileName, type ExportFormat } from "@/lib/export";
import { File, Paths } from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; entries: number }
  | { kind: "error"; message: string };

/**
 * Export (Manage → Download my journal).
 *
 * The only copy of a journal that survives losing both the password and the
 * recovery key, and the honest answer to "can I take my writing with me?".
 */
export default function ExportScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const dataStore = useDataStore();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const run = async (format: ExportFormat) => {
    if (status.kind === "working") return;
    const userId = session?.user.id;
    if (!userId) {
      setStatus({ kind: "error", message: "You're signed out. Sign in first." });
      return;
    }
    setStatus({ kind: "working" });
    try {
      // Read everything directly, unfiltered by month. A partial export is
      // worse than none — the user would believe they had a full copy.
      const [entries, logs] = await Promise.all([
        getAllEntries(userId),
        getAllHabitLogs(userId),
      ]);
      if (!entries.ok) {
        setStatus({
          kind: "error",
          message:
            "Couldn't read your entries, so nothing was written. Check your connection and try again.",
        });
        return;
      }

      const now = new Date();
      const contents = buildExport(
        {
          entries: entries.data,
          habits: dataStore.habits,
          // Habits are the nice-to-have half; a failed log read still exports
          // the writing, which is the part that can't be recreated.
          logs: logs.ok ? logs.data : [],
          username: dataStore.profile?.username ?? null,
          exportedAt: now,
        },
        format,
      );

      const file = new File(Paths.cache, exportFileName(format, now));
      if (file.exists) file.delete();
      file.create();
      file.write(contents);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: format === "json" ? "application/json" : "text/markdown",
          dialogTitle: "Save your journal",
        });
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStatus({ kind: "done", entries: entries.data.length });
    } catch (e) {
      if (__DEV__) console.warn("[export] failed:", e);
      setStatus({
        kind: "error",
        message: "Something went wrong and nothing was saved. Try again.",
      });
    }
  };

  const working = status.kind === "working";

  return (
    <PaperBackground>
      <ScreenHeader title="Download my journal" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <Text style={styles.intro}>
          Everything you&apos;ve written, in a file you can keep.
        </Text>

        <View style={styles.section}>
          <PaperCard style={styles.card}>
            <Text style={styles.rowTitle}>Readable copy</Text>
            <Text style={styles.rowSubtitle}>
              One section per day, habits included. Opens in any notes app.
            </Text>
            <PressableScale
              containerStyle={styles.selfStart}
              style={[styles.button, working && styles.buttonOff]}
              disabled={working}
              onPress={() => void run("markdown")}
              accessibilityLabel="Download a readable copy of your journal"
            >
              {working ? (
                <ActivityIndicator size="small" color={Colors.paper} />
              ) : (
                <Text style={styles.buttonText}>Download</Text>
              )}
            </PressableScale>
          </PaperCard>
        </View>

        <View style={styles.section}>
          <PaperCard style={styles.card}>
            <Text style={styles.rowTitle}>Full data copy</Text>
            <Text style={styles.rowSubtitle}>
              Raw JSON. For backups, or moving to another app.
            </Text>
            <PressableScale
              containerStyle={styles.selfStart}
              style={[styles.secondaryButton, working && styles.buttonOff]}
              disabled={working}
              onPress={() => void run("json")}
              accessibilityLabel="Download the full data copy"
            >
              <Text style={styles.secondaryText}>Download JSON</Text>
            </PressableScale>
          </PaperCard>
        </View>

        {status.kind === "done" ? (
          <Text style={styles.doneText}>
            Saved — {status.entries}{" "}
            {status.entries === 1 ? "entry" : "entries"} written out.
          </Text>
        ) : null}
        {status.kind === "error" ? (
          <Text style={styles.errorText}>{status.message}</Text>
        ) : null}

        <Text style={styles.footnote}>
          Photos aren&apos;t included — they&apos;re already in your photo
          library.
        </Text>
      </ScrollView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  /**
   * Goes on PressableScale's `containerStyle`, never its `style`.
   * `style` lands on the inner animated view, so shrinking the
   * button there leaves the outer Pressable stretched full width —
   * a tap target far wider than anything the user can see.
   */
  selfStart: { alignSelf: "flex-start" },
  intro: {
    fontSize: 14,
    lineHeight: 21,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 4,
    marginBottom: 20,
  },
  section: { marginBottom: 18 },
  card: { paddingHorizontal: 18, paddingVertical: 18 },
  rowTitle: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
  rowSubtitle: {
    fontSize: 13,
    lineHeight: 20,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 4,
  },
  button: {
    marginTop: 16,
    minWidth: 130,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
    borderRadius: 999,
    backgroundColor: Colors.ink,
  },
  buttonText: {
    fontSize: 14,
    color: Colors.paper,
    fontFamily: Fonts.handwritingSemiBold,
  },
  secondaryButton: {
    marginTop: 16,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.ink,
  },
  secondaryText: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
  },
  buttonOff: { opacity: 0.5 },
  doneText: {
    fontSize: 14,
    color: Colors.success,
    fontFamily: Fonts.handwriting,
    marginHorizontal: 4,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.danger,
    fontFamily: Fonts.handwriting,
    marginHorizontal: 4,
  },
  footnote: {
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginTop: 18,
    marginHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Hairline.base,
    paddingTop: 14,
  },
});
