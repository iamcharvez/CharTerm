import { describe, expect, it } from "vitest";
import {
  calculateIpv4,
  calculateIpv6,
  formatIpv6,
  parseIpv6,
} from "./ipCalculator";

describe("IPv4 calculator", () => {
  it("calculates a conventional subnet and usable range", () => {
    const result = calculateIpv4("192.168.10.42/24");
    expect(result).toMatchObject({
      cidr: "192.168.10.0/24",
      networkAddress: "192.168.10.0",
      broadcastAddress: "192.168.10.255",
      firstUsable: "192.168.10.1",
      lastUsable: "192.168.10.254",
      subnetMask: "255.255.255.0",
      wildcardMask: "0.0.0.255",
      usableHosts: "254",
      scope: "Private network",
    });
  });

  it("supports point-to-point and single-host prefixes", () => {
    expect(calculateIpv4("10.0.0.4/31").usableHosts).toBe("2");
    expect(calculateIpv4("10.0.0.7/32").firstUsable).toBe("10.0.0.7");
  });

  it("rejects invalid addresses and prefixes", () => {
    expect(() => calculateIpv4("192.168.1.300/24")).toThrow();
    expect(() => calculateIpv4("192.168.1.1/33")).toThrow();
  });
});

describe("IPv6 calculator", () => {
  it("parses and emits canonical compressed addresses", () => {
    expect(formatIpv6(parseIpv6("2001:0db8:0000:0000:0000:ff00:0042:8329"))).toBe(
      "2001:db8::ff00:42:8329",
    );
    expect(formatIpv6(parseIpv6("::"))).toBe("::");
    expect(formatIpv6(parseIpv6("::ffff:192.0.2.128"))).toBe(
      "::ffff:c000:280",
    );
  });

  it("calculates a 128-bit network without losing precision", () => {
    const result = calculateIpv6("2001:db8:abcd:12::99/64");
    expect(result).toMatchObject({
      cidr: "2001:db8:abcd:12::/64",
      networkAddress: "2001:db8:abcd:12::",
      lastAddress: "2001:db8:abcd:12:ffff:ffff:ffff:ffff",
      totalAddresses: "18,446,744,073,709,551,616",
      addressCountPower: "2^64",
      scope: "Documentation range",
    });
  });

  it("rejects malformed IPv6 input", () => {
    expect(() => calculateIpv6("2001:::1/64")).toThrow();
    expect(() => calculateIpv6("2001:db8:zz::1/64")).toThrow();
    expect(() => calculateIpv6("2001:db8::1/129")).toThrow();
  });
});
