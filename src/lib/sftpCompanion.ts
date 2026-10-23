import type { ConnectionProfile } from "../stores/useAppStore";

export function createSftpCompanion(
  connection: ConnectionProfile,
): ConnectionProfile {
  const sourceName = connection.name.trim() || connection.host || "SSH";
  return {
    ...connection,
    name: `${sourceName} · Files`,
    protocol: "sftp",
  };
}
