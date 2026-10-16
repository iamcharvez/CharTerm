export type IpFamily = "ipv4" | "ipv6";

export type IpCalculation = {
  family: IpFamily;
  inputAddress: string;
  normalizedAddress: string;
  expandedAddress: string;
  prefix: number;
  cidr: string;
  networkAddress: string;
  lastAddress: string;
  firstUsable: string;
  lastUsable: string;
  totalAddresses: string;
  addressCountPower: string;
  hostBits: number;
  scope: string;
  reverseDns: string;
  binaryAddress: string;
  binaryPrefix: string;
  subnetMask?: string;
  wildcardMask?: string;
  broadcastAddress?: string;
  usableHosts?: string;
  previousSubnet?: string;
  nextSubnet?: string;
};

const IPV4_MAX = (1n << 32n) - 1n;
const IPV6_MAX = (1n << 128n) - 1n;

function formatCount(value: bigint) {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function parseInput(input: string, fallbackPrefix: number, maximum: number) {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Enter an IP address.");
  const pieces = trimmed.split("/");
  if (pieces.length > 2) throw new Error("Enter one address with an optional CIDR prefix.");
  const prefix = pieces[1] === undefined ? fallbackPrefix : Number(pieces[1]);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maximum) {
    throw new Error(`Prefix length must be between 0 and ${maximum}.`);
  }
  return { address: pieces[0].trim(), prefix };
}

export function parseIpv4(address: string): bigint {
  const octets = address.split(".");
  if (octets.length !== 4) throw new Error("Enter a valid IPv4 address with four octets.");
  return octets.reduce((value, octet) => {
    if (!/^\d{1,3}$/.test(octet)) throw new Error("IPv4 octets must be numbers from 0 to 255.");
    const number = Number(octet);
    if (number > 255) throw new Error("IPv4 octets must be numbers from 0 to 255.");
    return (value << 8n) | BigInt(number);
  }, 0n);
}

export function formatIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n]
    .map((shift) => Number((value >> shift) & 255n))
    .join(".");
}

function ipv4Scope(value: bigint) {
  const inRange = (network: string, prefix: number) => {
    const base = parseIpv4(network);
    const mask = prefix === 0 ? 0n : IPV4_MAX ^ ((1n << BigInt(32 - prefix)) - 1n);
    return (value & mask) === base;
  };
  if (value === 0n) return "Unspecified address";
  if (value === IPV4_MAX) return "Limited broadcast";
  if (inRange("10.0.0.0", 8) || inRange("172.16.0.0", 12) || inRange("192.168.0.0", 16)) return "Private network";
  if (inRange("100.64.0.0", 10)) return "Shared address space (CGNAT)";
  if (inRange("127.0.0.0", 8)) return "Loopback";
  if (inRange("169.254.0.0", 16)) return "Link-local";
  if (inRange("224.0.0.0", 4)) return "Multicast";
  if (inRange("192.0.2.0", 24) || inRange("198.51.100.0", 24) || inRange("203.0.113.0", 24)) return "Documentation range";
  if (inRange("240.0.0.0", 4)) return "Reserved";
  return "Public address";
}

export function calculateIpv4(input: string, fallbackPrefix = 24): IpCalculation {
  const { address, prefix } = parseInput(input, fallbackPrefix, 32);
  const value = parseIpv4(address);
  const hostBits = 32 - prefix;
  const hostMask = hostBits === 0 ? 0n : (1n << BigInt(hostBits)) - 1n;
  const mask = IPV4_MAX ^ hostMask;
  const network = value & mask;
  const broadcast = network | hostMask;
  const total = 1n << BigInt(hostBits);
  const usable = prefix <= 30 ? total - 2n : total;
  const firstUsable = prefix <= 30 ? network + 1n : network;
  const lastUsable = prefix <= 30 ? broadcast - 1n : broadcast;
  const previous = network >= total ? network - total : null;
  const next = broadcast < IPV4_MAX ? broadcast + 1n : null;
  const binary = value.toString(2).padStart(32, "0").match(/.{8}/g)?.join(".") ?? "";
  const maskBinary = mask.toString(2).padStart(32, "0").match(/.{8}/g)?.join(".") ?? "";
  const normalizedAddress = formatIpv4(value);

  return {
    family: "ipv4",
    inputAddress: address,
    normalizedAddress,
    expandedAddress: normalizedAddress,
    prefix,
    cidr: `${formatIpv4(network)}/${prefix}`,
    networkAddress: formatIpv4(network),
    lastAddress: formatIpv4(broadcast),
    firstUsable: formatIpv4(firstUsable),
    lastUsable: formatIpv4(lastUsable),
    totalAddresses: formatCount(total),
    addressCountPower: `2^${hostBits}`,
    hostBits,
    scope: ipv4Scope(value),
    reverseDns: `${normalizedAddress.split(".").reverse().join(".")}.in-addr.arpa`,
    binaryAddress: binary,
    binaryPrefix: maskBinary,
    subnetMask: formatIpv4(mask),
    wildcardMask: formatIpv4(hostMask),
    broadcastAddress: formatIpv4(broadcast),
    usableHosts: formatCount(usable),
    previousSubnet: previous === null ? undefined : `${formatIpv4(previous)}/${prefix}`,
    nextSubnet: next === null ? undefined : `${formatIpv4(next)}/${prefix}`,
  };
}

export function parseIpv6(address: string): bigint {
  let normalized = address.trim().toLowerCase();
  const zoneIndex = normalized.indexOf("%");
  if (zoneIndex >= 0) normalized = normalized.slice(0, zoneIndex);
  if (!normalized || normalized.includes(":::")) throw new Error("Enter a valid IPv6 address.");

  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":");
    if (separator < 0) throw new Error("Enter a valid IPv6 address.");
    const ipv4 = parseIpv4(normalized.slice(separator + 1));
    const high = ((ipv4 >> 16n) & 0xffffn).toString(16);
    const low = (ipv4 & 0xffffn).toString(16);
    normalized = `${normalized.slice(0, separator)}:${high}:${low}`;
  }

  if ((normalized.match(/::/g) ?? []).length > 1) throw new Error("An IPv6 address can contain only one :: abbreviation.");
  const compressed = normalized.includes("::");
  const [leftText, rightText = ""] = normalized.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    throw new Error("IPv6 groups must contain one to four hexadecimal digits.");
  }
  const present = left.length + right.length;
  if ((!compressed && present !== 8) || (compressed && present >= 8)) {
    throw new Error("An IPv6 address must contain eight groups before abbreviation.");
  }
  const groups = compressed
    ? [...left, ...Array(8 - present).fill("0"), ...right]
    : left;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function ipv6Groups(value: bigint) {
  return Array.from({ length: 8 }, (_, index) =>
    Number((value >> BigInt((7 - index) * 16)) & 0xffffn),
  );
}

export function formatIpv6Expanded(value: bigint): string {
  return ipv6Groups(value).map((group) => group.toString(16).padStart(4, "0")).join(":");
}

export function formatIpv6(value: bigint): string {
  const groups = ipv6Groups(value);
  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  for (let index = 0; index <= groups.length; index += 1) {
    if (index < groups.length && groups[index] === 0) {
      if (currentStart < 0) currentStart = index;
    } else if (currentStart >= 0) {
      const length = index - currentStart;
      if (length > bestLength && length >= 2) {
        bestStart = currentStart;
        bestLength = length;
      }
      currentStart = -1;
    }
  }
  if (bestStart < 0) return groups.map((group) => group.toString(16)).join(":");
  const before = groups.slice(0, bestStart).map((group) => group.toString(16)).join(":");
  const after = groups.slice(bestStart + bestLength).map((group) => group.toString(16)).join(":");
  return `${before}::${after}`;
}

function ipv6Scope(value: bigint) {
  const inPrefix = (base: bigint, prefix: number) => {
    const mask = prefix === 0 ? 0n : IPV6_MAX ^ ((1n << BigInt(128 - prefix)) - 1n);
    return (value & mask) === base;
  };
  if (value === 0n) return "Unspecified address";
  if (value === 1n) return "Loopback";
  if (inPrefix(0xffn << 120n, 8)) return "Multicast";
  if (inPrefix(0x3fan << 118n, 10)) return "Link-local"; // fe80::/10
  if (inPrefix(0x7en << 121n, 7)) return "Unique local"; // fc00::/7
  if (inPrefix(0x20010db8n << 96n, 32)) return "Documentation range";
  if (inPrefix(0xffffn << 32n, 96)) return "IPv4-mapped IPv6";
  if (inPrefix(0x1n << 125n, 3)) return "Global unicast"; // 2000::/3
  return "Special or reserved";
}

export function calculateIpv6(input: string, fallbackPrefix = 64): IpCalculation {
  const { address, prefix } = parseInput(input, fallbackPrefix, 128);
  const value = parseIpv6(address);
  const hostBits = 128 - prefix;
  const hostMask = hostBits === 0 ? 0n : (1n << BigInt(hostBits)) - 1n;
  const mask = IPV6_MAX ^ hostMask;
  const network = value & mask;
  const last = network | hostMask;
  const total = 1n << BigInt(hostBits);
  const blockSize = total;
  const previous = network >= blockSize ? network - blockSize : null;
  const next = last < IPV6_MAX ? last + 1n : null;
  const expanded = formatIpv6Expanded(value);
  const binary = value.toString(2).padStart(128, "0").match(/.{16}/g)?.join(" ") ?? "";
  const prefixBinary = mask.toString(2).padStart(128, "0").match(/.{16}/g)?.join(" ") ?? "";

  return {
    family: "ipv6",
    inputAddress: address,
    normalizedAddress: formatIpv6(value),
    expandedAddress: expanded,
    prefix,
    cidr: `${formatIpv6(network)}/${prefix}`,
    networkAddress: formatIpv6(network),
    lastAddress: formatIpv6(last),
    firstUsable: formatIpv6(network),
    lastUsable: formatIpv6(last),
    totalAddresses: formatCount(total),
    addressCountPower: `2^${hostBits}`,
    hostBits,
    scope: ipv6Scope(value),
    reverseDns: `${expanded.replaceAll(":", "").split("").reverse().join(".")}.ip6.arpa`,
    binaryAddress: binary,
    binaryPrefix: prefixBinary,
    previousSubnet: previous === null ? undefined : `${formatIpv6(previous)}/${prefix}`,
    nextSubnet: next === null ? undefined : `${formatIpv6(next)}/${prefix}`,
  };
}

export function calculateIp(family: IpFamily, input: string, prefix: number) {
  return family === "ipv4" ? calculateIpv4(input, prefix) : calculateIpv6(input, prefix);
}
