export type VoiceTestMode = "mock" | "live";
export type VoiceTestProvider = "vapi" | "none";

function readVoiceTestMode(value: string | undefined): VoiceTestMode {
  return value === "live" ? "live" : "mock";
}

function readVoiceTestProvider(value: string | undefined): VoiceTestProvider {
  return value === "vapi" ? "vapi" : "none";
}

function readEnabled(value: string | undefined) {
  return value === "true";
}

const voiceTestMode = readVoiceTestMode(process.env.NEXT_PUBLIC_RESTAURANT_VOICE_TEST_MODE);
const configuredEnabled = readEnabled(process.env.NEXT_PUBLIC_RESTAURANT_VOICE_TEST_ENABLED);

export const restaurantCallTestConfig = {
  voiceTestMode,
  voiceTestEnabled: voiceTestMode === "mock" ? true : configuredEnabled,
  voiceTestPhoneNumber: process.env.NEXT_PUBLIC_RESTAURANT_VOICE_TEST_PHONE_NUMBER || null,
  voiceTestProvider: readVoiceTestProvider(process.env.NEXT_PUBLIC_RESTAURANT_VOICE_TEST_PROVIDER),
  voiceTestStatusLabelFR: voiceTestMode === "live" && !configuredEnabled ? "Disponible dès l'activation du test vocal" : "Prêt",
  voiceTestStatusLabelEN: voiceTestMode === "live" && !configuredEnabled ? "Available once voice testing is enabled" : "Ready",
} as const;
