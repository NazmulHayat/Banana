// Voice dictation for the highlight composer (FR-E6).
//
// PRIVACY — read before changing anything here.
//
// 1. ON-DEVICE ONLY, enforced twice. Apple's speech API can transcribe either
//    on the phone or on Apple's servers. For a zero-knowledge journal the
//    second one is a breach: dictated audio is the rawest possible form of the
//    exact text we encrypt so that not even we can read it. So:
//      a. `plugins/with-mic-only-speech.js` strips
//         NSSpeechRecognitionUsageDescription from the Info.plist.
//         SFSpeechRecognizer.requestAuthorization() traps on a missing usage
//         description, so the app *cannot* request network recognition.
//      b. `requiresOnDeviceRecognition: true` on every start, and we refuse to
//         start at all unless `supportsOnDeviceRecognition()` is true. That
//         flag alone is not enough — the library documents it as "only enabled
//         if the device supports it", i.e. it silently falls back to the
//         network on a device that can't do it locally.
//    Never call `requestSpeechRecognizerPermissionsAsync()`. That function
//    exists specifically to authorize sending voice to Apple.
//
// 2. Microphone permission is the ONLY permission requested. On-device
//    recognition needs nothing else.
//
// 3. No audio is ever written to disk. `recordingOptions.persist` defaults to
//    false and is never set here. Nothing is uploaded; the transcript becomes
//    ordinary entry text and is encrypted like anything else you type.
//
// 4. The mic is never left hot. It stops on unmount, when the app leaves the
//    foreground, and at DICTATION_MAX_MS no matter what.

import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

/**
 * Loaded defensively rather than with a static import. `expo-speech-recognition`
 * resolves its native module at import time and THROWS when it isn't there —
 * in Expo Go, which cannot contain custom native modules, or in any dev build
 * made before this dependency landed. A static import turns that throw into a
 * module-level crash that takes down every screen importing the composer, so
 * the tracker and the feed both die over an optional mic.
 *
 * Missing module is simply another flavour of "this device can't dictate",
 * which is a state the feature already handles: the mic is hidden and typing
 * is unaffected.
 */
type SpeechModule = typeof import("expo-speech-recognition");

const speech: SpeechModule | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-speech-recognition") as SpeechModule;
  } catch {
    return null;
  }
})();

/**
 * Stands in for `useSpeechRecognitionEvent` when the native module is absent.
 * Calls no hooks of its own, which is safe because `speech` is resolved once
 * at module load and never changes — the hook order is stable for the life of
 * the app, it just differs between a dev build and Expo Go.
 */
const useSpeechEvent: SpeechModule["useSpeechRecognitionEvent"] =
  speech?.useSpeechRecognitionEvent ?? (() => {});

/**
 * Hard ceiling on one dictation. A highlight is a sentence or two, and a mic
 * that runs unbounded is both a battery drain and a trust problem — the user
 * must never wonder whether it is still listening.
 *
 * 55s, not the 2 minutes this used to claim. `SFSpeechRecognizer` caps a
 * single request at roughly one minute and then cuts out on its own, so the
 * old ceiling was fiction: iOS ended the session first, mid-sentence, with no
 * explanation. Stopping just under the real limit means the mic closes on our
 * terms. Raising this needs the iOS 26 `SpeechAnalyzer` engine, which has no
 * such cap (see Nice-to-haves in tasks.md).
 */
export const DICTATION_MAX_MS = 55_000;

/**
 * Whether this device can transcribe locally. False on the simulator, on older
 * hardware, and before the locale model has been downloaded. When false the
 * composer hides the mic entirely rather than offering a button that would
 * have to send audio away to work.
 */
export function isDictationAvailable(): boolean {
  if (!speech) return false;
  return speech.ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
}

/**
 * One user-safe sentence per failure. Raw codes never reach the screen
 * (NFR-4), and dictation failing is never fatal — the field stays editable, so
 * the fallback is always "type it".
 */
function messageForError(code: string): string {
  switch (code) {
    case "not-allowed":
      return "Microphone access is off. You can turn it on in Settings.";
    case "no-speech":
    case "speech-timeout":
      return "Didn't catch anything that time.";
    case "interrupted":
      return "Something interrupted the mic. Try again.";
    case "audio-capture":
      return "Couldn't reach the microphone.";
    case "busy":
      return "The mic is busy. Try again in a moment.";
    case "service-not-allowed":
    case "language-not-supported":
      return "Dictation isn't available on this device.";
    case "network":
      // Should be unreachable: we never permit network recognition. If it ever
      // fires, something has gone wrong with the on-device guarantee.
      return "Dictation isn't available on this device.";
    case "aborted":
      return "";
    default:
      return "Dictation stopped unexpectedly.";
  }
}

/**
 * Fold a finalized segment into what has already been dictated.
 *
 * iOS returns a cumulative transcript within one recognition task but can also
 * emit a fresh task mid-session, and the two look identical from here. Testing
 * for the prefix covers both: a cumulative final restates everything and
 * replaces, a segmented final is new words and appends. Getting this wrong
 * duplicates the user's sentence, so it is deliberately defensive.
 */
export function commitSegment(committed: string, incoming: string): string {
  const next = incoming.trim();
  if (!next) return committed;
  if (!committed) return next;
  if (next.startsWith(committed)) return next;
  return `${committed} ${next}`;
}

/**
 * Resolve once the app is foreground-active, or after `timeoutMs` either way.
 *
 * `requestMicrophonePermissionsAsync()` resolves the instant the user taps
 * Allow, while iOS is still dismissing the alert and the app is still
 * `inactive`. Activating an audio session inside that window makes iOS post an
 * `AVAudioSession.interruptionNotification`, which the recognizer reports as
 * the `interrupted` error — so the very first dictation dies before the user
 * has said a word, on the one tap where a good first impression matters most.
 *
 * The timeout is a safety valve: if the `active` transition never arrives the
 * mic button must still do something rather than hang forever.
 */
function waitForActive(timeoutMs = 2_000): Promise<void> {
  if (AppState.currentState === "active") return Promise.resolve();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (timer) clearTimeout(timer);
      sub.remove();
      resolve();
    });
    timer = setTimeout(() => {
      sub.remove();
      resolve();
    }, timeoutMs);
  });
}

export interface Dictation {
  /** False when the device can't transcribe locally — hide the control. */
  available: boolean;
  listening: boolean;
  /** Everything dictated in this session: finalized segments + live partial. */
  transcript: string;
  /** User-safe sentence, or null. Empty string means "say nothing". */
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  /** Drop the transcript so the next session starts clean. */
  reset: () => void;
}

export function useDictation(): Dictation {
  const [available] = useState(isDictationAvailable);
  const [listening, setListening] = useState(false);
  const [committed, setCommitted] = useState("");
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timeout.current) {
      clearTimeout(timeout.current);
      timeout.current = null;
    }
  };

  useSpeechEvent("start", () => setListening(true));
  useSpeechEvent("end", () => {
    setListening(false);
    clearTimer();
  });

  useSpeechEvent("result", (event) => {
    const transcript = event.results[0]?.transcript ?? "";
    if (event.isFinal) {
      setCommitted((prev) => commitSegment(prev, transcript));
      setPartial("");
    } else {
      // Within a segment the recognizer revises what it already returned, so
      // the live partial is replaced wholesale rather than appended.
      setPartial(transcript);
    }
  });

  useSpeechEvent("error", (event) => {
    // The user-facing sentence is deliberately vague; the raw code is what
    // makes a failure diagnosable. Never log the transcript — that's entry text.
    if (__DEV__) console.warn(`[dictation] ${event.error}: ${event.message}`);
    setError(messageForError(event.error));
    setListening(false);
    clearTimer();
  });

  // Never leave the mic running past this screen, and never keep it open in
  // the background — iOS would keep the indicator lit with nothing to show it.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") speech?.ExpoSpeechRecognitionModule.abort();
    });
    return () => {
      sub.remove();
      speech?.ExpoSpeechRecognitionModule.abort();
    };
  }, []);

  useEffect(() => clearTimer, []);

  const stop = () => {
    clearTimer();
    speech?.ExpoSpeechRecognitionModule.stop();
  };

  const start = async () => {
    setError(null);

    // Re-checked at every start, not just at mount: this is the guarantee.
    if (!isDictationAvailable()) {
      setError("Dictation isn't available on this device.");
      return;
    }

    if (!speech) return;

    const permission =
      await speech.ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
    if (!permission.granted) {
      setError("Microphone access is off. You can turn it on in Settings.");
      return;
    }

    // See waitForActive: starting the audio session while the permission alert
    // is still dismissing is what produced "Something interrupted the mic."
    await waitForActive();

    setCommitted("");
    setPartial("");

    speech.ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: true,
      addsPunctuation: true,
      iosTaskHint: "dictation",
    });

    clearTimer();
    timeout.current = setTimeout(() => {
      speech?.ExpoSpeechRecognitionModule.stop();
    }, DICTATION_MAX_MS);
  };

  const reset = () => {
    setCommitted("");
    setPartial("");
    setError(null);
  };

  const transcript = partial
    ? committed
      ? `${committed} ${partial}`
      : partial
    : committed;

  return { available, listening, transcript, error, start, stop, reset };
}
