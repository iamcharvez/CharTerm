import type {
  ConnectionProfile,
  LegacyCompatibility,
} from "../stores/useAppStore";

export function detectLegacyCompatibility(
  output: string,
  connection?: ConnectionProfile,
): { compatibility: LegacyCompatibility; message: string } | null {
  const text = output.toLowerCase();
  if (
    text.includes("no matching host key type found") &&
    text.includes("ssh-rsa") &&
    !connection?.allowLegacySshRsa
  ) {
    return {
      compatibility: "host-key",
      message: "Legacy SSH-RSA host key detected. Retrying automatically…",
    };
  }
  if (
    text.includes("no matching mac found") &&
    text.includes("hmac-sha1") &&
    !connection?.allowLegacyMacSha1
  ) {
    return {
      compatibility: "mac",
      message: "Legacy SHA-1 MAC detected. Retrying automatically…",
    };
  }
  if (
    text.includes("no matching key exchange method found") &&
    text.includes("diffie-hellman") &&
    text.includes("sha1") &&
    !connection?.allowLegacyKexSha1
  ) {
    return {
      compatibility: "key-exchange",
      message: "Legacy key exchange detected. Retrying automatically…",
    };
  }
  if (
    text.includes("no matching cipher found") &&
    text.includes("cbc") &&
    !connection?.allowLegacyCiphers
  ) {
    return {
      compatibility: "cipher",
      message: "Legacy SSH cipher detected. Retrying automatically…",
    };
  }
  return null;
}
