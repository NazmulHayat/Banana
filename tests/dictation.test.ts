// Voice dictation (FR-E6) — the two pieces that can be tested headlessly.
//
// 1. `commitSegment` folds a finalized speech segment into what has already
//    been dictated. iOS returns a cumulative transcript inside one recognition
//    task but can start a fresh task mid-session, and the two are
//    indistinguishable from the JS side. Getting the fold wrong duplicates the
//    user's sentence in their journal, so every shape is pinned here.
// 2. `isDictationAvailable` is the on-device gate. It must be false whenever
//    the answer is anything but a confident yes — a false positive is the one
//    path that could send audio to Apple.
//
// Module handling: lib/dictation imports react-native for AppState and
// requires expo-speech-recognition, neither of which loads headless. Both are
// intercepted before the require, same pattern as tests/db-cache.test.ts. The
// hook itself needs a renderer and is verified on a device instead.

import "./setup";
import { assertEq, assertTrue, run, suite, test } from "./helpers";

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const ModuleCtor = require("module") as { _load: Loader };
const realLoad = ModuleCtor._load;

/** What the stubbed native module reports for on-device support. */
let onDeviceSupported = true;
/** When true, requiring expo-speech-recognition throws — Expo Go / old build. */
let nativeModuleMissing = false;

const stubs: Record<string, unknown> = {
  "react-native": {
    AppState: { addEventListener: () => ({ remove: () => {} }) },
  },
};

ModuleCtor._load = function patchedLoad(request, parent, isMain) {
  if (request === "expo-speech-recognition") {
    if (nativeModuleMissing) {
      throw new Error("Cannot find native module 'ExpoSpeechRecognition'");
    }
    return {
      useSpeechRecognitionEvent: () => {},
      ExpoSpeechRecognitionModule: {
        supportsOnDeviceRecognition: () => onDeviceSupported,
        start: () => {},
        stop: () => {},
        abort: () => {},
      },
    };
  }
  if (request in stubs) return stubs[request];
  return realLoad.call(this, request, parent, isMain);
};

/** Load a fresh copy of lib/dictation under the current stub settings. */
function loadDictation(): typeof import("../lib/dictation") {
  delete require.cache[require.resolve("../lib/dictation")];
  return require("../lib/dictation") as typeof import("../lib/dictation");
}

const dictation = loadDictation();
const { commitSegment } = dictation;

// ---------------------------------------------------------------------------

suite("commitSegment");

test("first segment becomes the whole transcript", () => {
  assertEq(commitSegment("", "went for a run"), "went for a run");
});

test("a cumulative restatement replaces rather than duplicates", () => {
  // One recognition task revising itself: the final restates every word so far.
  assertEq(
    commitSegment("went for a run", "went for a run this morning"),
    "went for a run this morning",
  );
});

test("a fresh segment is appended with a single space", () => {
  assertEq(
    commitSegment("went for a run", "it rained the whole way"),
    "went for a run it rained the whole way",
  );
});

test("an identical final is idempotent", () => {
  assertEq(commitSegment("went for a run", "went for a run"), "went for a run");
});

test("empty and whitespace-only segments change nothing", () => {
  assertEq(commitSegment("went for a run", ""), "went for a run");
  assertEq(commitSegment("went for a run", "   \n "), "went for a run");
  assertEq(commitSegment("", "   "), "");
});

test("surrounding whitespace never leaks into the entry", () => {
  assertEq(commitSegment("", "  went for a run  "), "went for a run");
  assertEq(commitSegment("a", "  b  "), "a b");
});

test("a near-prefix is appended, not treated as cumulative", () => {
  // "ran" is not a prefix of "rang" backwards — only a true prefix replaces.
  assertEq(commitSegment("rang", "ran"), "rang ran");
});

// ---------------------------------------------------------------------------

suite("on-device gate");

test("available when the recognizer supports on-device", () => {
  onDeviceSupported = true;
  nativeModuleMissing = false;
  assertEq(loadDictation().isDictationAvailable(), true);
});

test("unavailable when the recognizer cannot work on-device", () => {
  // Simulator and older hardware. The mic is hidden rather than falling back
  // to Apple's servers.
  onDeviceSupported = false;
  nativeModuleMissing = false;
  assertEq(loadDictation().isDictationAvailable(), false);
});

test("unavailable, not crashing, when the native module is absent", () => {
  // Expo Go or a dev build made before the dependency landed. A throw here
  // would take down every screen that imports the composer.
  onDeviceSupported = true;
  nativeModuleMissing = true;
  assertEq(loadDictation().isDictationAvailable(), false);
});

suite("limits");

test("one dictation stops just under the recognizer's own 60s cut-off", () => {
  // SFSpeechRecognizer ends a request at ~60s regardless of what we ask for.
  // Our ceiling has to land below that or iOS cuts the user off mid-sentence.
  assertTrue(dictation.DICTATION_MAX_MS > 0);
  assertTrue(dictation.DICTATION_MAX_MS < 60_000);
  assertEq(dictation.DICTATION_MAX_MS, 55_000);
});

void run().finally(() => {
  ModuleCtor._load = realLoad;
});
