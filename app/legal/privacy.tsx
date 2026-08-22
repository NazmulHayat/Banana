import { PaperBackground } from "@/components/ui/paper-background";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Colors, Fonts } from "@/constants/theme";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Privacy Policy, rendered in-app (no external URL needed). Content mirrors
 * docs/privacy-policy.md — keep the two in sync if the policy changes.
 */
export default function PrivacyScreen() {
  const insets = useSafeAreaInsets();
  return (
    <PaperBackground>
      <ScreenHeader title="Privacy Policy" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 60,
        }}
      >
        <Text style={styles.updated}>Last updated: June 12, 2026</Text>

        <Text style={styles.paragraph}>
          Aight Bet is a private habit tracker and journal. Privacy isn&apos;t
          a feature we added — it&apos;s the architecture.
        </Text>

        <Text style={styles.heading}>The short version</Text>
        <Text style={styles.bullet}>
          • Your journal entries, habits, and habit history are end-to-end
          encrypted on your device before they ever reach our servers. We
          cannot read them. Nobody at Aight Bet can, even if we wanted to.
        </Text>
        <Text style={styles.bullet}>
          • Photos you attach are not end-to-end encrypted. They are stored in
          a private bucket only your account can reach, and encrypted at rest
          by our infrastructure, but unlike your writing they are not sealed
          with your personal key, which means we could technically access
          them. Your journal text, habits, dates and place names are
          end-to-end encrypted and we cannot read them.
        </Text>
        <Text style={styles.bullet}>
          • Voice dictation happens entirely on your device. If you dictate a
          highlight, your speech is turned into text on your phone. The audio
          is never saved to a file, never uploaded, and never sent to Apple or
          anyone else. The app does not even hold the iOS permission that
          would allow it.
        </Text>
        <Text style={styles.bullet}>
          • We don&apos;t sell data, we don&apos;t run ads, and we don&apos;t
          use third-party analytics or trackers.
        </Text>

        <Text style={styles.heading}>What we store</Text>
        <Text style={styles.paragraph}>
          Email address — plaintext, needed for login and account recovery.
        </Text>
        <Text style={styles.paragraph}>
          Password — never stored, only a cryptographic hash handled by our
          auth provider (Supabase).
        </Text>
        <Text style={styles.paragraph}>
          Journal entries, habits, habit logs — encrypted on your device with
          AES-256-GCM before upload. Even the dates of your entries are
          hidden from the server.
        </Text>
        <Text style={styles.paragraph}>
          Photos — stored in a private bucket only your account can access;
          encrypted at rest by our infrastructure. Not end-to-end encrypted,
          so we could technically access them.
        </Text>
        <Text style={styles.paragraph}>
          Username — plaintext, so we can check availability.
        </Text>
        <Text style={styles.paragraph}>
          Dictated speech — never stored anywhere. Transcribed on your device,
          never written to an audio file, never uploaded. The resulting text
          is encrypted exactly like text you type.
        </Text>

        <Text style={styles.heading}>How encryption works</Text>
        <Text style={styles.paragraph}>
          When you create an account, your device generates a master
          encryption key. That key is locked with your password and a
          recovery key shown to you once. All journal and habit data is
          encrypted with this key before leaving your phone. The server only
          ever sees ciphertext.
        </Text>
        <Text style={styles.paragraph}>
          This has a real consequence: if you lose both your password and
          your recovery key, your data cannot be recovered — by you or by
          us. That&apos;s not a policy choice; it&apos;s math.
        </Text>

        <Text style={styles.heading}>Where data lives</Text>
        <Text style={styles.paragraph}>
          Data is hosted on Supabase infrastructure. Encrypted data is
          unreadable to Supabase and to us. Your email and account metadata
          are subject to Supabase&apos;s own security practices.
        </Text>

        <Text style={styles.heading}>What we don&apos;t do</Text>
        <Text style={styles.bullet}>• No ads, no ad networks</Text>
        <Text style={styles.bullet}>
          • No selling or sharing data with third parties
        </Text>
        <Text style={styles.bullet}>
          • No third-party analytics or tracking SDKs
        </Text>
        <Text style={styles.bullet}>• No reading your content — we can&apos;t</Text>

        <Text style={styles.heading}>Deleting your account</Text>
        <Text style={styles.paragraph}>
          You can delete your account from the app (Profile → Delete
          Account). This permanently removes your account, all encrypted
          data, and all photos from our servers.
        </Text>

        <Text style={styles.heading}>Changes</Text>
        <Text style={styles.paragraph}>
          If this policy changes materially, we&apos;ll note it in the app
          and update the date above.
        </Text>

        <Text style={styles.heading}>Contact</Text>
        <Text style={styles.paragraph}>
          Questions: nazmulhayat588@gmail.com
        </Text>

        <View style={{ height: 20 }} />
      </ScrollView>
    </PaperBackground>
  );
}

const styles = StyleSheet.create({
  updated: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: Fonts.handwriting,
    marginBottom: 12,
  },
  heading: {
    fontSize: 16,
    color: Colors.ink,
    fontFamily: Fonts.handwritingSemiBold,
    marginTop: 20,
    marginBottom: 8,
  },
  paragraph: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    lineHeight: 21,
    marginBottom: 10,
  },
  bullet: {
    fontSize: 14,
    color: Colors.ink,
    fontFamily: Fonts.handwriting,
    lineHeight: 21,
    marginBottom: 8,
  },
});
