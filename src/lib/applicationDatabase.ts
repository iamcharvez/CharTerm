import { invoke } from "@tauri-apps/api/core";
import {
  createPersistentSnapshot,
  type PersistentAppState,
  useAppStore,
} from "../stores/useAppStore";
import { hydratePreferences, loadPreferences } from "./preferences";

const LEGACY_STORAGE_KEY = "charterm-workspace";
const BROWSER_FALLBACK_KEY = "charterm-browser-preview";

function isDesktopRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function readJson(value: string | null): Partial<PersistentAppState> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as {
      state?: Partial<PersistentAppState>;
    } & Partial<PersistentAppState>;
    return parsed.state ?? parsed;
  } catch {
    return undefined;
  }
}

function readLegacyState() {
  return readJson(localStorage.getItem(LEGACY_STORAGE_KEY))
    ?? readJson(localStorage.getItem(BROWSER_FALLBACK_KEY));
}

async function saveDesktopState(snapshot: PersistentAppState) {
  await invoke("save_application_state", {
    stateJson: JSON.stringify(snapshot),
  });
}

function respectSessionRecovery(snapshot: Partial<PersistentAppState> | undefined) {
  if (!snapshot || loadPreferences().restoreSessions) return snapshot;
  return { ...snapshot, terminalTabs: [], activeTerminalId: null, terminalPaneIds: [], terminalLayout: "single" as const };
}

export async function initializeApplicationDatabase() {
  const desktop = isDesktopRuntime();
  let snapshot: Partial<PersistentAppState> | undefined;

  if (desktop) {
    const stored = await invoke<string | null>("load_application_state");
    snapshot = readJson(stored);
  }

  const legacy = readLegacyState();
  const importedLegacy = !snapshot && legacy;
  snapshot ??= legacy;
  hydratePreferences(snapshot?.preferences);
  snapshot = respectSessionRecovery(snapshot);
  useAppStore.getState().hydrateApplicationState(snapshot);

  if (desktop) {
    if (importedLegacy) {
      await saveDesktopState(createPersistentSnapshot(useAppStore.getState()));
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      localStorage.removeItem(BROWSER_FALLBACK_KEY);
    }
  } else {
    localStorage.setItem(
      BROWSER_FALLBACK_KEY,
      JSON.stringify(createPersistentSnapshot(useAppStore.getState())),
    );
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const next = respectSessionRecovery(createPersistentSnapshot(useAppStore.getState())) as PersistentAppState;
      if (desktop) {
        void saveDesktopState(next).catch((error) => console.error("Could not save CharTerm application state", error));
      } else localStorage.setItem(BROWSER_FALLBACK_KEY, JSON.stringify(next));
    }, 300);
  };
  const unsubscribeStore = useAppStore.subscribe((state, previous) => {
    if (!state.databaseReady || state === previous) return;
    persist();
  });
  window.addEventListener("charterm-preferences", persist);
  if (desktop) localStorage.removeItem("charterm-preferences");
  return () => { unsubscribeStore(); window.removeEventListener("charterm-preferences", persist); clearTimeout(timer); };
}
