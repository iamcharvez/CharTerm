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

let cachedPreferences: CharTermPreferences = (() => {
  try {
    const stored = typeof localStorage === "undefined" ? null : localStorage.getItem("charterm-preferences");
    return stored ? { ...defaultPreferences, ...JSON.parse(stored) } : defaultPreferences;
  } catch { return defaultPreferences; }
})();

export function loadPreferences(): CharTermPreferences {
  if (typeof localStorage !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
    const stored = localStorage.getItem("charterm-preferences");
    if (stored) {
      try { cachedPreferences = { ...defaultPreferences, ...JSON.parse(stored) }; }
      catch { cachedPreferences = defaultPreferences; }
    }
  }
  return cachedPreferences;
}

export function savePreferences(preferences: CharTermPreferences) {
  cachedPreferences = { ...defaultPreferences, ...preferences };
  if (!("__TAURI_INTERNALS__" in window)) {
    localStorage.setItem("charterm-preferences", JSON.stringify(cachedPreferences));
  }
  window.dispatchEvent(
    new CustomEvent("charterm-preferences", { detail: cachedPreferences }),
  );
}

export function hydratePreferences(preferences?: Partial<CharTermPreferences>) {
  if (!preferences) return;
  cachedPreferences = { ...defaultPreferences, ...preferences };
  window.dispatchEvent(new CustomEvent("charterm-preferences", { detail: cachedPreferences }));
}
