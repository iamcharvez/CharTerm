import {
  Binary,
  Braces,
  Calculator,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Globe2,
  Hash,
  Info,
  Network,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  calculateIp,
  type IpCalculation,
  type IpFamily,
} from "../../lib/ipCalculator";

const presets: Record<IpFamily, number[]> = {
  ipv4: [8, 16, 24, 30, 31, 32],
  ipv6: [32, 48, 56, 64, 96, 127, 128],
};

export function IpCalculatorPage() {
  const [family, setFamily] = useState<IpFamily>("ipv4");
  const [addresses, setAddresses] = useState({
    ipv4: "192.168.1.10",
    ipv6: "2001:db8:abcd:12::1",
  });
  const [prefixes, setPrefixes] = useState({ ipv4: 24, ipv6: 64 });
  const [copied, setCopied] = useState<string | null>(null);
  const maximum = family === "ipv4" ? 32 : 128;
  const prefix = prefixes[family];
  const address = addresses[family];

  const calculation = useMemo(() => {
    try {
      return { result: calculateIp(family, address, prefix), error: null };
    } catch (reason) {
      return {
        result: null,
        error: reason instanceof Error ? reason.message : String(reason),
      };
    }
  }, [address, family, prefix]);

  const changeAddress = (value: string) => {
    setAddresses((current) => ({ ...current, [family]: value }));
    const cidrPrefix = value.match(/\/(\d{1,3})\s*$/)?.[1];
    if (cidrPrefix !== undefined) {
      const parsed = Number(cidrPrefix);
      if (parsed >= 0 && parsed <= maximum) {
        setPrefixes((current) => ({ ...current, [family]: parsed }));
      }
    }
  };

  const changePrefix = (value: number) => {
    const bounded = Math.max(0, Math.min(maximum, value));
    setPrefixes((current) => ({ ...current, [family]: bounded }));
    setAddresses((current) => ({
      ...current,
      [family]: current[family].replace(/\/\d{1,3}\s*$/, ""),
    }));
  };

  const copyValue = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1400);
  };

  const moveToSubnet = (cidr?: string) => {
    if (!cidr) return;
    const [nextAddress, nextPrefix] = cidr.split("/");
    setAddresses((current) => ({ ...current, [family]: nextAddress }));
    setPrefixes((current) => ({ ...current, [family]: Number(nextPrefix) }));
  };

  return (
    <main className="workspace-page calculator-page">
      <header className="workspace-header">
        <div>
          <span>Network tools</span>
          <h1>IP &amp; Subnet Calculator</h1>
          <p>
            Understand address ranges, masks, prefixes, and capacity for IPv4
            and IPv6 networks.
          </p>
        </div>
        <div className="calculator-family-switch" aria-label="IP version">
          <button
            className={family === "ipv4" ? "active" : ""}
            type="button"
            onClick={() => setFamily("ipv4")}
          >
            IPv4 <small>Default</small>
          </button>
          <button
            className={family === "ipv6" ? "active" : ""}
            type="button"
            onClick={() => setFamily("ipv6")}
          >
            IPv6
          </button>
        </div>
      </header>

      <section className="calculator-input-card">
        <div className="calculator-input-heading">
          <span><Calculator size={19} /></span>
          <div>
            <strong>{family === "ipv4" ? "IPv4 network" : "IPv6 network"}</strong>
            <small>Enter an address by itself or include CIDR notation.</small>
          </div>
        </div>

        <div className="calculator-input-grid">
          <label className="field">
            <span>IP address or CIDR</span>
            <div className="calculator-address-input">
              <Globe2 size={17} />
              <input
                value={address}
                onChange={(event) => changeAddress(event.target.value)}
                placeholder={family === "ipv4" ? "192.168.1.10/24" : "2001:db8::1/64"}
                spellCheck={false}
                autoFocus
              />
            </div>
          </label>
          <label className="field calculator-prefix-field">
            <span>Prefix length</span>
            <div>
              <b>/</b>
              <input
                type="number"
                min={0}
                max={maximum}
                value={prefix}
                onChange={(event) => changePrefix(Number(event.target.value))}
              />
            </div>
          </label>
        </div>

        <div className="prefix-control">
          <input
            aria-label="Prefix length"
            type="range"
            min={0}
            max={maximum}
            value={prefix}
            onChange={(event) => changePrefix(Number(event.target.value))}
          />
          <div className="prefix-presets">
            <span>Common prefixes</span>
            {presets[family].map((item) => (
              <button
                className={prefix === item ? "active" : ""}
                type="button"
                key={item}
                onClick={() => changePrefix(item)}
              >
                /{item}
              </button>
            ))}
          </div>
        </div>
      </section>

      {calculation.error ? (
        <section className="calculator-error" role="alert">
          <Info size={20} />
          <div><strong>Check the address</strong><span>{calculation.error}</span></div>
        </section>
      ) : calculation.result ? (
        <CalculatorResults
          result={calculation.result}
          copied={copied}
          onCopy={copyValue}
          onMove={moveToSubnet}
        />
      ) : null}
    </main>
  );
}

function CalculatorResults({
  result,
  copied,
  onCopy,
  onMove,
}: {
  result: IpCalculation;
  copied: string | null;
  onCopy: (id: string, value: string) => Promise<void>;
  onMove: (cidr?: string) => void;
}) {
  const isIpv4 = result.family === "ipv4";
  const maximum = isIpv4 ? 32 : 128;

  return (
    <div className="calculator-results">
      <section className="calculator-summary">
        <div>
          <span className="section-kicker">Calculated network</span>
          <h2>{result.cidr}</h2>
          <div className="calculator-badges">
            <span><ShieldCheck size={13} /> {result.scope}</span>
            <span><Hash size={13} /> {result.hostBits} host bits</span>
          </div>
        </div>
        <button type="button" onClick={() => void onCopy("cidr", result.cidr)}>
          {copied === "cidr" ? <Check size={17} /> : <Copy size={17} />}
          {copied === "cidr" ? "Copied" : "Copy CIDR"}
        </button>
        <div className="prefix-visual" aria-label={`${result.prefix} network bits and ${result.hostBits} host bits`}>
          <span style={{ width: `${(result.prefix / maximum) * 100}%` }} />
        </div>
        <div className="prefix-visual-labels">
          <span>{result.prefix} network bits</span>
          <span>{result.hostBits} host bits</span>
        </div>
      </section>

      <div className="calculator-result-grid">
        <ResultCard icon={<Network size={18} />} eyebrow="Network" title="Subnet details">
          <ValueRow id="network" label="Network prefix" value={result.networkAddress} copied={copied} onCopy={onCopy} />
          {isIpv4 && result.subnetMask && (
            <ValueRow id="mask" label="Subnet mask" value={result.subnetMask} copied={copied} onCopy={onCopy} />
          )}
          {isIpv4 && result.wildcardMask && (
            <ValueRow id="wildcard" label="Wildcard mask" value={result.wildcardMask} copied={copied} onCopy={onCopy} />
          )}
          <ValueRow id="scope" label="Address type" value={result.scope} copied={copied} onCopy={onCopy} />
        </ResultCard>

        <ResultCard icon={<Braces size={18} />} eyebrow="Range" title="Address boundaries">
          <ValueRow id="first" label={isIpv4 ? "First usable" : "First address"} value={result.firstUsable} copied={copied} onCopy={onCopy} />
          <ValueRow id="last" label={isIpv4 ? "Last usable" : "Last address"} value={result.lastUsable} copied={copied} onCopy={onCopy} />
          {isIpv4 && result.broadcastAddress && (
            <ValueRow id="broadcast" label="Broadcast" value={result.broadcastAddress} copied={copied} onCopy={onCopy} />
          )}
          <ValueRow id="count" label={isIpv4 ? "Total addresses" : "Addresses in prefix"} value={result.totalAddresses} secondary={result.addressCountPower} copied={copied} onCopy={onCopy} />
          {isIpv4 && result.usableHosts && (
            <ValueRow id="usable" label="Usable hosts" value={result.usableHosts} copied={copied} onCopy={onCopy} />
          )}
        </ResultCard>

        <ResultCard icon={<Binary size={18} />} eyebrow="Representation" title="Address formats" wide>
          <ValueRow id="normalized" label={isIpv4 ? "Normalized" : "Compressed"} value={result.normalizedAddress} copied={copied} onCopy={onCopy} />
          {!isIpv4 && (
            <ValueRow id="expanded" label="Expanded" value={result.expandedAddress} copied={copied} onCopy={onCopy} />
          )}
          <ValueRow id="binary" label="Address in binary" value={result.binaryAddress} copied={copied} onCopy={onCopy} wrap />
          <ValueRow id="prefix-binary" label="Prefix mask in binary" value={result.binaryPrefix} copied={copied} onCopy={onCopy} wrap />
          <ValueRow id="reverse" label="Reverse DNS pointer" value={result.reverseDns} copied={copied} onCopy={onCopy} wrap />
          {!isIpv4 && (
            <div className="ipv6-note"><Info size={14} /> IPv6 has no broadcast address; multicast provides group delivery.</div>
          )}
        </ResultCard>
      </div>

      <section className="subnet-navigation">
        <div>
          <span className="section-kicker">Adjacent blocks</span>
          <strong>Move between /{result.prefix} networks</strong>
        </div>
        <div>
          <button type="button" disabled={!result.previousSubnet} onClick={() => onMove(result.previousSubnet)}>
            <ChevronLeft size={16} /><span><small>Previous</small>{result.previousSubnet ?? "Not available"}</span>
          </button>
          <button type="button" disabled={!result.nextSubnet} onClick={() => onMove(result.nextSubnet)}>
            <span><small>Next</small>{result.nextSubnet ?? "Not available"}</span><ChevronRight size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}

function ResultCard({
  icon,
  eyebrow,
  title,
  wide = false,
  children,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`calculator-result-card ${wide ? "wide" : ""}`}>
      <header><span>{icon}</span><div><small>{eyebrow}</small><h3>{title}</h3></div></header>
      <div>{children}</div>
    </section>
  );
}

function ValueRow({
  id,
  label,
  value,
  secondary,
  copied,
  onCopy,
  wrap = false,
}: {
  id: string;
  label: string;
  value: string;
  secondary?: string;
  copied: string | null;
  onCopy: (id: string, value: string) => Promise<void>;
  wrap?: boolean;
}) {
  return (
    <div className={`calculator-value-row ${wrap ? "wrap" : ""}`}>
      <span>{label}</span>
      <div><code>{value}</code>{secondary && <small>{secondary}</small>}</div>
      <button type="button" title={`Copy ${label}`} aria-label={`Copy ${label}`} onClick={() => void onCopy(id, value)}>
        {copied === id ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
