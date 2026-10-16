export type AppMetadata = {
  name: string;
  version: string;
  source: "tauri" | "build";
};

const buildMetadata: AppMetadata = {
  name: __APP_NAME__,
  version: __APP_VERSION__,
  source: "build",
};

export async function getAppMetadata(): Promise<AppMetadata> {
  if (!("__TAURI_INTERNALS__" in window)) {
    return buildMetadata;
  }

  try {
    const { getName, getVersion } = await import("@tauri-apps/api/app");
    const [name, version] = await Promise.all([getName(), getVersion()]);
    return { name, version, source: "tauri" };
  } catch {
    return buildMetadata;
  }
}

