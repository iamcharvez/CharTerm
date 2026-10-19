import { invoke } from "@tauri-apps/api/core";

export type ActivityLogLevel = "debug" | "info" | "warn" | "error";

function isDesktop() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function recordActivity(
  level: ActivityLogLevel,
  category: string,
  message: string,
  details?: Record<string, string | number | boolean | null | undefined>,
) {
  if (!isDesktop()) return;
  const safeDetails = details
    ? Object.fromEntries(
        Object.entries(details).filter(
          ([key, value]) =>
            !/(password|passphrase|secret|token|private.?key)/i.test(key) &&
            value !== undefined,
        ),
      )
    : undefined;
  void invoke("record_activity_log", {
    level,
    category,
    message,
    details: safeDetails ? JSON.stringify(safeDetails) : null,
  }).catch(() => undefined);
}
