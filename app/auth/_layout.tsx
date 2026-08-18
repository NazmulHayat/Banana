import { Colors } from "@/constants/theme";
import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.paper },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="signin" />
      <Stack.Screen name="verify" />
      <Stack.Screen name="recovery-setup" />
      <Stack.Screen name="forgot-password" />
      {/* Where the password-reset email lands (deep link `aightbet://`). */}
      <Stack.Screen name="reset-password" />
      <Stack.Screen name="recover-with-key" />
    </Stack>
  );
}
