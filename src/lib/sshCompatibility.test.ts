import { detectLegacyCompatibility } from "./sshCompatibility";

describe("SSH legacy compatibility detection", () => {
  it.each([
    ["no matching host key type found. Their offer: ssh-rsa", "host-key"],
    ["no matching MAC found. Their offer: hmac-sha1,hmac-sha1-96", "mac"],
    [
      "no matching key exchange method found. Their offer: diffie-hellman-group1-sha1",
      "key-exchange",
    ],
    ["no matching cipher found. Their offer: aes128-cbc,3des-cbc", "cipher"],
  ])("recognizes %s", (message, expected) => {
    expect(detectLegacyCompatibility(message)?.compatibility).toBe(expected);
  });

  it("does not repeatedly enable an already active exception", () => {
    expect(
      detectLegacyCompatibility(
        "no matching MAC found. Their offer: hmac-sha1",
        {
          id: "test",
          name: "test",
          protocol: "ssh",
          favorite: false,
          createdAt: 0,
          allowLegacyMacSha1: true,
        },
      ),
    ).toBeNull();
  });
});
