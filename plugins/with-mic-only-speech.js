// Config plugin — strips NSSpeechRecognitionUsageDescription (FR-E6).
//
// expo-speech-recognition's own config plugin ALWAYS writes
// NSSpeechRecognitionUsageDescription and gives no prop to opt out of it.
// That key is what authorizes handing audio to Apple's servers; on-device
// recognition needs only NSMicrophoneUsageDescription.
//
// Deleting the key is not cosmetic. SFSpeechRecognizer.requestAuthorization()
// traps on a missing usage description, so with it gone the app *cannot*
// request network recognition — the guarantee stops depending on us
// remembering to pass requiresOnDeviceRecognition: true at every call site.
// See the privacy notes at the top of lib/dictation.ts.
//
// Must be listed AFTER "expo-speech-recognition" in app.json.
const { withInfoPlist } = require("expo/config-plugins");

module.exports = function withMicOnlySpeech(config) {
  return withInfoPlist(config, (cfg) => {
    delete cfg.modResults.NSSpeechRecognitionUsageDescription;
    return cfg;
  });
};
