import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors, Fonts, Hairline, Scrim } from "@/constants/theme";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { StyleSheet, View } from "react-native";

export default function TabLayout() {
  // DataProvider lives at the root layout so pushed pages (analysis, habits,
  // security) share the same store. Its priority prefetching is unchanged.
  return (
    <Tabs
        screenOptions={{
          // Active vs inactive used to be ink against textSecondary — 16.3:1
          // and 8.3:1 on paper, close enough that the whole bar read as one
          // dark row. textMuted opens that gap while still clearing AA.
          tabBarActiveTintColor: Colors.ink,
          tabBarInactiveTintColor: Colors.textMuted,
          headerShown: false,
          tabBarButton: HapticTab,
          tabBarBackground: () => (
            <View style={StyleSheet.absoluteFill}>
              <BlurView
                intensity={60}
                tint="light"
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.glassOverlay} />
            </View>
          ),
          tabBarStyle: {
            backgroundColor: "transparent",
            borderTopColor: Hairline.base,
            borderTopWidth: 1,
            elevation: 0,
          },
          tabBarLabelStyle: {
            // ShantellSans can't synthesize weight on iOS, so the old
            // `fontWeight: "600"` here rendered as plain regular.
            fontFamily: Fonts.handwritingSemiBold,
            fontSize: 11,
            marginTop: 2,
            letterSpacing: 0.2,
          },
          tabBarItemStyle: {
            paddingTop: 6,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Tracker",
            tabBarIcon: ({ color }) => (
              <IconSymbol
                size={24}
                name="checkmark.circle.fill"
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="feed"
          options={{
            title: "Feed",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={24} name="book.fill" color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color }) => (
              <IconSymbol size={24} name="person.fill" color={color} />
            ),
          }}
        />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  glassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Scrim.paper,
  },
});
