export type CharTermPreferences = {
  confirmBeforeClosing: boolean;
  restoreSessions: boolean;
  fontSize: number;
  scrollback: number;
  cursorStyle: "block" | "bar" | "underline";
  connectionTimeout: number;
  keepaliveSeconds: number;
  notifications: boolean;
  reducedMotion: boolean;
};

export const defaultPreferences: CharTermPreferences = {
  confirmBeforeClosing: true,
  restoreSessions: false,
  fontSize: 14,
  scrollback: 10_000,
  cursorStyle: "bar",
  connectionTimeout: 10,
  keepaliveSeconds: 30,
  notifications: true,
  reducedMotion: false,
};

export function loadPreferences(): CharTermPreferences {
  try {
    const stored = localStorage.getItem("charterm-preferences");
    return stored
      ? { ...defaultPreferences, ...JSON.parse(stored) }
      : defaultPreferences;
  } catch {
    return defaultPreferences;
  }
}

export function savePreferences(preferences: CharTermPreferences) {
  localStorage.setItem("charterm-preferences", JSON.stringify(preferences));
  window.dispatchEvent(
    new CustomEvent("charterm-preferences", { detail: preferences }),
  );
}
