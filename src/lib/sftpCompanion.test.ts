import { describe, expect, it } from "vitest";
import type { ConnectionProfile } from "../stores/useAppStore";
import { createSftpCompanion } from "./sftpCompanion";

describe("SFTP companion connections", () => {
  it("reuses the active SSH endpoint and authentication settings", () => {
    const ssh: ConnectionProfile = {
      id: "saved-server",
      name: "Printer server",
      protocol: "ssh",
      host: "192.0.2.10",
      port: 2222,
      username: "operator",
      authenticationMode: "identity",
      identityId: "operations-key",
      hasSavedPassword: true,
      favorite: false,
      createdAt: 1,
    };

    expect(createSftpCompanion(ssh)).toEqual({
      ...ssh,
      name: "Printer server · Files",
      protocol: "sftp",
    });
  });
});
