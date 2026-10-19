import { invoke } from "@tauri-apps/api/core";

const isDesktop = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function updateNativeConnection(
  id: string,
  protocol: string,
  label: string,
  state: "starting" | "active" | "closed" | "error",
  error?: string,
) {
  if (!isDesktop()) return Promise.resolve();
  return invoke("update_connection_runtime", {
    id,
    protocol,
    label,
    state,
    error: error ?? null,
  }).catch(() => undefined);
}

export function removeNativeConnection(id: string) {
  if (!isDesktop()) return Promise.resolve();
  return invoke("remove_connection_runtime", { id }).catch(() => undefined);
}

export function updateNativeJob(
  id: string,
  kind: string,
  label: string,
  state: "queued" | "running" | "complete" | "cancelled" | "error",
  progress?: number,
  error?: string,
) {
  if (!isDesktop()) return Promise.resolve();
  return invoke("update_background_job", {
    id,
    kind,
    label,
    state,
    progress: progress ?? null,
    error: error ?? null,
  }).catch(() => undefined);
}
