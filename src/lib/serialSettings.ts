export const baudRateGroups = [
  { label: "Classic and legacy", rates: [50, 75, 110, 134, 150, 200, 300, 600, 1200, 1800, 2400, 4800, 7200] },
  { label: "Common console speeds", rates: [9600, 14400, 19200, 28800, 38400, 56000, 57600, 76800, 115200] },
  { label: "High speed", rates: [128000, 230400, 256000, 460800, 500000, 576000, 921600, 1000000, 1500000, 2000000, 3000000, 4000000] },
] as const;

export const commonBaudRates: number[] = baudRateGroups.flatMap((group) => [...group.rates]);

export function serialFormatLabel(
  baudRate: number,
  dataBits: number,
  parity: "none" | "odd" | "even",
  stopBits: number,
) {
  const parityCode = parity === "none" ? "N" : parity === "even" ? "E" : "O";
  return `${baudRate.toLocaleString()} baud · ${dataBits}-${parityCode}-${stopBits}`;
}
