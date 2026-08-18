import { PaperBackground } from "@/components/ui/paper-background";
import { ScreenHeader } from "@/components/ui/screen-header";
import { Colors, Fonts } from "@/constants/theme";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Terms of Service, rendered in-app (no external URL needed). Kept
 * consistent with docs/privacy-policy.md — zero-knowledge encryption,
 * photos not E2E in v1, no warranty, account deletion.
 */
export default function TermsScreen() {
  const insets = useSafeAreaInsets();
  return (
    <PaperBackground>
      <ScreenHeader title="Terms of Service" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 60,
        }}
      >
        <Text style={styles.updated}>Last updated: June 12, 2026</Text>

        <Text style={styles.paragraph}>
          By using Aight Bet, you agree to these terms. If you don&apos;t
          agree, please don&apos;t use the app.
        </Text>

        <Text style={styles.heading}>Your account</Text>
        <Text style={styles.paragraph}>
          You&apos;re responsible for keeping your password and recovery key
          safe. Aight Bet is end-to-end encrypted — because we never see
          your unencrypted data, we cannot help you regain access if you
          lose both your password and your recovery key. This is a
          consequence of the encryption design, not a limitation we can lift.
        </Text>

        <Text style={styles.heading}>Encryption &amp; your data</Text>
        <Text style={styles.paragraph}>
          Journal entries, habits, and habit history are encrypted on your
          device before upload — we cannot read them. Photos you attach are
          stored in a private, account-scoped bucket but are not yet
          end-to-end encrypted in this version of the app; treat photo
          attachments accordingly.
        </Text>

        <Text style={styles.heading}>Acceptable use</Text>
        <Text style={styles.paragraph}>
          Use Aight Bet for its intended purpose — personal habit tracking
          and journaling. Don&apos;t attempt to access another user&apos;s
          account or data, disrupt the service, or use it for anything
          unlawful.
        </Text>

        <Text style={styles.heading}>No warranty</Text>
        <Text style={styles.paragraph}>
          Aight Bet is provided &quot;as is,&quot; without warranty of any
          kind. We do our best to keep your data safe and the app running,
          but we don&apos;t guarantee uninterrupted or error-free service.
          To the extent permitted by law, we&apos;re not liable for any loss
          of data or damages arising from your use of the app — including
          data that becomes unrecoverable due to a lost password and
          recovery key.
        </Text>

        <Text style={styles.heading}>Deleting your account</Text>
        <Text style={styles.paragraph}>
          You can delete your account at any time from Profile → Delete
          Account. This permanently and irreversibly removes your account,
          all encrypted data, and all photos from our servers.
        </Text>

        <Text style={styles.heading}>Changes to these terms</Text>
        <Text style={styles.paragraph}>
          If we make material changes to these terms, we&apos;ll note it in
          the app and update the date above.
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
});
