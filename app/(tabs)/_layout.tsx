import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors, Fonts } from "@/constants/theme";
import { useAuth } from "@/lib/auth-context";
import { DataProvider } from "@/lib/data-store";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { StyleSheet, View } from "react-native";

export default function TabLayout() {
  const { session } = useAuth();

  // DataProvider handles all priority-based prefetching:
  // P1: Habits (blocking for minimal UI)
  // P2: Habit logs (progressive, non-blocking)
  // P3: Entries + Profile (parallel with P2)
  // P4: Adjacent months (background, lowest priority)

  return (
    <DataProvider session={session}>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors.ink,
          tabBarInactiveTintColor: Colors.textSecondary,
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
            borderTopColor: "rgba(26, 26, 26, 0.08)",
            borderTopWidth: 1,
            elevation: 0,
          },
          tabBarLabelStyle: {
            fontFamily: Fonts.handwriting,
            fontSize: 11,
            fontWeight: "600",
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
    </DataProvider>
  );
}

const styles = StyleSheet.create({
  glassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(251, 248, 233, 0.55)",
  },
});
