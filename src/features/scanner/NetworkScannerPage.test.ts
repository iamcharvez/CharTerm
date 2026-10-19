import { describe, expect, it } from "vitest";
import { analyzeScanTargets, getPortActions, mergeScanHost, splitScanTargets } from "./NetworkScannerPage";

describe("network scanner service actions", () => {
  it("offers browser actions for HTTP and HTTPS ports", () => {
    expect(getPortActions({ port: 80, protocol: "tcp", service: "http" }).web).toBe(true);
    expect(getPortActions({ port: 443, protocol: "tcp", service: "https" }).web).toBe(true);
    expect(getPortActions({ port: 9443, protocol: "tcp", service: "https-alt" }).web).toBe(true);
    expect(getPortActions({ port: 3000, protocol: "tcp", service: "unknown" }).web).toBe(true);
  });

  it("offers direct CharTerm actions for SSH and Telnet", () => {
    expect(getPortActions({ port: 2222, protocol: "tcp", service: "ssh" }).ssh).toBe(true);
    expect(getPortActions({ port: 2323, protocol: "tcp", service: "telnet" }).telnet).toBe(true);
  });

  it("accepts multiple newline and comma separated targets without duplicates", () => {
    expect(splitScanTargets("192.168.1.0/24\n10.0.0.0/24, 192.168.1.0/24")).toEqual([
      "192.168.1.0/24",
      "10.0.0.0/24",
    ]);
  });

  it("normalizes CIDR hosts to the actual network address", () => {
    expect(analyzeScanTargets("192.168.0.1/24")).toMatchObject({
      entries: ["192.168.0.0/24"],
      normalized: "192.168.0.0/24",
      estimatedAddresses: 256,
      corrections: [{ from: "192.168.0.1/24", to: "192.168.0.0/24" }],
    });
  });

  it("accepts shorthand and full IPv4 ranges", () => {
    expect(analyzeScanTargets("192.168.1.1-254\n192.168.2.1-192.168.10.254")).toMatchObject({
      entries: ["192.168.1.1-192.168.1.254", "192.168.2.1-192.168.10.254"],
      estimatedAddresses: 2556,
    });
  });

  it("reports invalid and reversed ranges", () => {
    expect(analyzeScanTargets("192.168.1.254-1").error).toContain("reversed");
    expect(analyzeScanTargets("192.168.1.1-999").error).toContain("Invalid ending address");
    expect(analyzeScanTargets("192.168.1.999").error).toContain("Invalid IPv4 address");
  });

  it("merges live host updates while retaining MAC and discovered ports", () => {
    const current = [{ address: "10.0.0.2", macAddress: "AA:BB:CC:DD:EE:FF", ports: [{ port: 22, protocol: "tcp", service: "ssh" }] }];
    expect(mergeScanHost(current, { address: "10.0.0.2", ports: [{ port: 80, protocol: "tcp", service: "http" }] })[0]).toMatchObject({
      macAddress: "AA:BB:CC:DD:EE:FF",
      ports: [{ port: 22 }, { port: 80 }],
    });
  });
});
