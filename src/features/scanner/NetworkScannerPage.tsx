import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Globe2,
  LoaderCircle,
  Network,
  Play,
  Radar,
  Server,
  ShieldCheck,
  Square,
  TerminalSquare,
  Waypoints,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAppStore, type ConnectionProfile } from "../../stores/useAppStore";
import { recordActivity } from "../../lib/activityLog";
import { updateNativeJob } from "../../lib/nativeCore";

type ScannerStatus = { nmapAvailable: boolean; nmapVersion?: string };
export type ScanPort = { port: number; protocol: string; service: string; product?: string };
export type ScanHost = { address: string; hostname?: string; macAddress?: string; vendor?: string; ports: ScanPort[] };
export type ScanTargetAnalysis = {
  entries: string[];
  normalized: string;
  estimatedAddresses: number;
  corrections: { from: string; to: string }[];
  error?: string;
};
type ScanEvent =
  | { event: "started"; engine: string }
  | { event: "progress"; completed: number; total: number }
  | { event: "host"; host: ScanHost }
  | { event: "complete"; hosts: ScanHost[]; engine: string }
  | { event: "cancelled" }
  | { event: "error"; message: string };

const commonPorts = "21,22,23,25,53,80,81,110,135,139,143,443,445,993,995,1433,1521,3000,3306,3389,5000,5432,5900,6379,8000,8080,8081,8443,8888,9000,9090,9443";
const commonWebPorts = [80, 81, 3000, 5000, 7001, 8000, 8008, 8080, 8081, 8443, 8888, 9000, 9090, 9443];
const commonSecureWebPorts = [443, 8443, 9443];

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function NetworkScannerPage() {
  const openConnection = useAppStore((state) => state.openConnection);
  const [status, setStatus] = useState<ScannerStatus>({ nmapAvailable: false });
  const [target, setTarget] = useState("");
  const [engine, setEngine] = useState("auto");
  const [mode, setMode] = useState("ports");
  const [portPreset, setPortPreset] = useState("common");
  const [customPorts, setCustomPorts] = useState("22,80,443");
  const [serviceDetection, setServiceDetection] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState(350);
  const [concurrency, setConcurrency] = useState(96);
  const [running, setRunning] = useState(false);
  const [scanId, setScanId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [activeEngine, setActiveEngine] = useState<string | null>(null);
  const [hosts, setHosts] = useState<ScanHost[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke<ScannerStatus>("get_scanner_status").then(setStatus).catch(() => undefined);
  }, []);

  const ports = portPreset === "common" ? commonPorts : portPreset === "top" ? "22,23,53,80,139,443,445,3389,8080,8443" : customPorts;
  const percent = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
  const targetAnalysis = useMemo(() => analyzeScanTargets(target), [target]);
  const targetCount = targetAnalysis.entries.length;
  const openPortCount = useMemo(() => hosts.reduce((total, host) => total + host.ports.length, 0), [hosts]);

  const startScan = async (event: FormEvent) => {
    event.preventDefault();
    if (!target.trim()) { setError("Enter an IP address, hostname, or subnet such as 192.168.1.0/24."); return; }
    if (targetAnalysis.error) { setError(targetAnalysis.error); return; }
    const normalizedTarget = targetAnalysis.normalized;
    if (normalizedTarget !== target.trim()) setTarget(normalizedTarget);
    const id = crypto.randomUUID();
    setScanId(id);
    setRunning(true);
    setHosts([]);
    setError(null);
    setProgress({ completed: 0, total: 0 });
    void recordActivity("info", "scanner", "Network scan started", {
      targetEntries: targetCount,
      estimatedAddresses: targetAnalysis.estimatedAddresses,
      engine,
      mode,
    });
    void updateNativeJob(id, "network-scan", "Network scan", "running", 0);
    const onEvent = new Channel<ScanEvent>();
    onEvent.onmessage = (message) => {
      if (message.event === "started") setActiveEngine(message.engine);
      if (message.event === "progress") setProgress(message);
      if (message.event === "host") setHosts((current) => mergeScanHost(current, message.host));
      if (message.event === "complete") {
        setHosts(message.hosts); setActiveEngine(message.engine); setRunning(false);
        void recordActivity("info", "scanner", "Network scan completed", {
          devices: message.hosts.length,
          openPorts: message.hosts.reduce((total, host) => total + host.ports.length, 0),
          engine: message.engine,
        });
        void updateNativeJob(id, "network-scan", "Network scan", "complete", 1);
      }
      if (message.event === "cancelled") {
        setRunning(false); setError("Scan cancelled.");
        void recordActivity("warn", "scanner", "Network scan cancelled");
        void updateNativeJob(id, "network-scan", "Network scan", "cancelled");
      }
      if (message.event === "error") {
        setRunning(false); setError(message.message);
        void recordActivity("error", "scanner", "Network scan failed");
        void updateNativeJob(id, "network-scan", "Network scan", "error", undefined, message.message);
      }
    };
    try {
      await invoke("start_network_scan", {
        request: {
          scanId: id,
          target: normalizedTarget,
          ports,
          engine,
          mode,
          timeoutMs,
          concurrency,
          serviceDetection,
        },
        onEvent,
      });
    } catch (reason) {
      setRunning(false);
      setError(String(reason));
      void recordActivity("error", "scanner", "Network scan could not start");
      void updateNativeJob(id, "network-scan", "Network scan", "error", undefined, String(reason));
    }
  };

  const cancelScan = async () => {
    if (scanId) await invoke("cancel_network_scan", { scanId });
  };

  const connectTerminal = (host: ScanHost, port: ScanPort, protocol: "ssh" | "telnet") => {
    const profile: ConnectionProfile = {
      id: crypto.randomUUID(), name: `${host.hostname || host.address}:${port.port}`, protocol,
      host: host.address, port: port.port, favorite: false, createdAt: Date.now(),
      authenticationMode: protocol === "ssh" ? "password" : undefined,
    };
    openConnection(profile);
  };

  const openWebService = async (host: ScanHost, port: ScanPort) => {
    const secure = commonSecureWebPorts.includes(port.port) || port.service.toLowerCase().includes("https");
    const address = host.address.includes(":") && !host.address.startsWith("[") ? `[${host.address}]` : host.address;
    const defaultPort = secure ? 443 : 80;
    const url = `${secure ? "https" : "http"}://${address}${port.port === defaultPort ? "" : `:${port.port}`}/`;
    try {
      if (isTauriRuntime()) await openUrl(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (reason) {
      setError(`Could not open ${url} in the default browser: ${String(reason)}`);
    }
  };

  const exportResults = () => {
    const rows = ["address,hostname,mac_address,vendor,port,protocol,service,product"];
    for (const host of hosts) for (const port of host.ports) rows.push([host.address, host.hostname ?? "", host.macAddress ?? "", host.vendor ?? "", port.port, port.protocol, port.service, port.product ?? ""].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = `charterm-scan-${Date.now()}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  return (
    <main className="workspace-page scanner-page">
      <header className="workspace-header">
        <div><span>Network tools</span><h1>Network Scanner</h1><p>Discover devices and inspect open TCP ports without leaving CharTerm.</p></div>
        <div className={`scanner-engine-badge ${status.nmapAvailable ? "ready" : "fallback"}`}>
          {status.nmapAvailable ? <CheckCircle2 size={15} /> : <Radar size={15} />}
          {status.nmapAvailable ? status.nmapVersion : "Built-in scanner ready"}
        </div>
      </header>

      <div className="scanner-layout">
        <form className="scanner-controls" onSubmit={(event) => void startScan(event)}>
          <div className="scanner-control-heading"><Radar size={22} /><div><strong>Scan configuration</strong><span>Only scan systems you own or are authorized to test.</span></div></div>
          <label className="field scanner-target-field"><span>Targets <small>{targetCount ? `${targetCount} selected · about ${targetAnalysis.estimatedAddresses.toLocaleString()} addresses` : "one per line or comma separated"}</small></span><textarea rows={4} value={target} onChange={(event) => { setTarget(event.target.value); setError(null); }} placeholder={"192.168.1.0/24\n192.168.2.1-254\n192.168.3.1-192.168.5.254"} disabled={running} /></label>
          <div className="scanner-target-formats" aria-label="Supported target formats"><span>Single IP or host</span><span>CIDR subnet</span><span>Short range</span><span>Start–end range</span></div>
          {target.trim() && targetAnalysis.error && <div className="scanner-target-feedback error"><AlertTriangle size={15} /><span>{targetAnalysis.error}</span></div>}
          {!targetAnalysis.error && targetAnalysis.corrections.length > 0 && <div className="scanner-target-feedback correction"><CheckCircle2 size={15} /><span>{targetAnalysis.corrections.map((item) => `${item.from} → ${item.to}`).join(" · ")}</span><button type="button" onClick={() => setTarget(targetAnalysis.normalized)} disabled={running}>Apply</button></div>}
          <div className="scanner-field-grid">
            <label className="field"><span>Engine</span><select value={engine} onChange={(event) => setEngine(event.target.value)} disabled={running}><option value="auto">Automatic</option><option value="builtin">Built-in TCP</option><option value="nmap" disabled={!status.nmapAvailable}>Nmap</option></select></label>
            <label className="field"><span>Scan type</span><select value={mode} onChange={(event) => setMode(event.target.value)} disabled={running}><option value="ports">Ports and devices</option><option value="discovery">Device discovery</option></select></label>
          </div>
          {mode === "ports" && <>
            <label className="field"><span>Ports</span><select value={portPreset} onChange={(event) => setPortPreset(event.target.value)} disabled={running}><option value="common">Common services</option><option value="top">Quick network ports</option><option value="custom">Custom list</option></select></label>
            {portPreset === "custom" && <label className="field"><span>Custom ports</span><input value={customPorts} onChange={(event) => setCustomPorts(event.target.value)} placeholder="22,80,443,8000-8010" disabled={running} /></label>}
            <label className="scanner-check"><input type="checkbox" checked={serviceDetection} disabled={running || (engine === "builtin") || (!status.nmapAvailable && engine === "auto")} onChange={(event) => setServiceDetection(event.target.checked)} /><span><strong>Service version detection</strong><small>Available when the Nmap engine is active.</small></span></label>
            <div className="scanner-advanced">
              <button type="button" onClick={() => setShowAdvanced((value) => !value)} aria-expanded={showAdvanced}><Waypoints size={15} /><span><strong>Advanced scan tuning</strong><small>Timeout and parallel checks</small></span><b>{showAdvanced ? "Hide" : "Configure"}</b></button>
              {showAdvanced && <div className="scanner-advanced-grid">
                <label className="field"><span>Port timeout <small>milliseconds</small></span><input type="number" min={100} max={10000} step={50} value={timeoutMs} disabled={running} onChange={(event) => setTimeoutMs(Number(event.target.value))} /></label>
                <label className="field"><span>Concurrency <small>parallel checks</small></span><input type="number" min={1} max={512} value={concurrency} disabled={running} onChange={(event) => setConcurrency(Number(event.target.value))} /></label>
              </div>}
            </div>
          </>}
          <div className="scanner-authorized"><ShieldCheck size={16} /><span>Scanning can create connection logs and alerts on target systems.</span></div>
          {!status.nmapAvailable && <div className="scanner-engine-note">The built-in engine finds devices through open TCP ports. Install Nmap for ARP/ICMP host discovery and detailed service versions.</div>}
          {running ? <button className="scanner-stop" type="button" onClick={() => void cancelScan()}><Square size={15} /> Stop scan</button> : <button className="primary-action scanner-start" type="submit"><Play size={16} /> Start scan</button>}
        </form>

        <section className="scanner-results">
          <div className="scanner-results-header"><div><strong>{running ? "Live results" : "Results"}</strong><span>{hosts.length} devices · {openPortCount} open ports{activeEngine ? ` · ${activeEngine}` : ""}</span></div>{hosts.length > 0 && <button type="button" onClick={exportResults}><Download size={15} /> Export CSV</button>}</div>
          {running && <div className="scan-progress"><div><LoaderCircle className="spin" size={18} /><span>Scanning {targetCount} target {targetCount === 1 ? "entry" : "entries"} · {hosts.length} found so far</span><strong>{progress.total ? `${percent}%` : "Discovering"}</strong></div><div className={`progress-track ${progress.total ? "" : "indeterminate"}`}><span style={progress.total ? { width: `${percent}%` } : undefined} /></div></div>}
          {error && <div className="scanner-error"><AlertTriangle size={17} /> {error}</div>}
          {!running && !error && hosts.length === 0 && <div className="scanner-empty"><span><Network size={31} /></span><h2>No scan results yet</h2><p>Enter a device or subnet and start a scan. CIDR ranges up to /22 are supported by the built-in engine.</p></div>}
          {hosts.length > 0 && <div className="scan-hosts">
            {hosts.map((host) => {
              const actionablePorts = host.ports.filter((port) => {
                const actions = getPortActions(port);
                return actions.web || actions.ssh || actions.telnet;
              });
              return <article className="scan-host" key={host.address}>
                <div className="scan-host-summary"><span><Server size={18} /></span><div><strong>{host.hostname || host.address}</strong>{host.hostname && <small>{host.address}</small>}<div className="scan-host-identity"><code>{host.macAddress || "MAC unavailable"}</code>{host.vendor && <em>{host.vendor}</em>}</div></div><b>{host.ports.length} open</b></div>
                <div className="scan-port-list">{host.ports.length ? host.ports.map((port) => {
                  const actions = getPortActions(port);
                  return <div key={`${port.protocol}-${port.port}`}><strong>{port.port}</strong><span>{port.protocol}</span><span>{port.service}</span><small>{port.product || "—"}</small><div className="scan-port-actions">
                    {actions.web && <button type="button" onClick={() => void openWebService(host, port)} title={`Open ${port.service || "web service"} in your browser`}><Globe2 size={13} /> Web <ExternalLink size={10} /></button>}
                    {actions.ssh && <button type="button" onClick={() => connectTerminal(host, port, "ssh")} title="Open this SSH service in CharTerm"><TerminalSquare size={13} /> SSH</button>}
                    {actions.telnet && <button type="button" onClick={() => connectTerminal(host, port, "telnet")} title="Open this Telnet service in CharTerm"><TerminalSquare size={13} /> Telnet</button>}
                  </div></div>;
                }) : <p>Host is online; no ports reported by this scan.</p>}</div>
                {actionablePorts.length > 0 && <div className="scan-host-actions" aria-label={`Open services on ${host.address}`}>
                  <span>Open service</span>
                  {actionablePorts.map((port) => {
                    const actions = getPortActions(port);
                    const secureWeb = commonSecureWebPorts.includes(port.port) || port.service.toLowerCase().includes("https");
                    return <div key={`${port.protocol}-${port.port}-actions`}>
                      {actions.web && <button type="button" onClick={() => void openWebService(host, port)} title="Open in your operating system's default browser"><Globe2 size={14} /> Open {secureWeb ? "HTTPS" : "HTTP"} <b>:{port.port}</b><ExternalLink size={11} /></button>}
                      {actions.ssh && <button type="button" onClick={() => connectTerminal(host, port, "ssh")}><TerminalSquare size={14} /> Connect SSH <b>:{port.port}</b></button>}
                      {actions.telnet && <button type="button" onClick={() => connectTerminal(host, port, "telnet")}><TerminalSquare size={14} /> Connect Telnet <b>:{port.port}</b></button>}
                    </div>;
                  })}
                </div>}
              </article>;
            })}
          </div>}
        </section>
      </div>
    </main>
  );
}

export function getPortActions(port: ScanPort) {
  const service = port.service.toLowerCase();
  return {
    web: commonWebPorts.includes(port.port) || service.includes("http"),
    ssh: port.port === 22 || service === "ssh",
    telnet: port.port === 23 || service === "telnet",
  };
}

export function splitScanTargets(value: string) {
  return analyzeScanTargets(value).entries;
}

function parseIpv4(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function ipv4Number(octets: number[]) {
  return octets.reduce((value, octet) => value * 256 + octet, 0);
}

function numberToIpv4(value: number) {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join(".");
}

export function analyzeScanTargets(value: string): ScanTargetAnalysis {
  const compact = value.replace(/\s*-\s*/g, "-");
  const rawEntries = compact.split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean);
  const entries: string[] = [];
  const corrections: { from: string; to: string }[] = [];
  let estimatedAddresses = 0;

  for (const raw of rawEntries) {
    let normalized = raw;
    let addressCount = 1;

    if (raw.includes("/")) {
      const pieces = raw.split("/");
      if (pieces.length !== 2) return { entries, normalized: entries.join("\n"), estimatedAddresses, corrections, error: `Invalid CIDR target: ${raw}.` };
      if (pieces[0].includes(":")) return { entries, normalized: entries.join("\n"), estimatedAddresses, corrections, error: "IPv6 CIDR ranges are not supported yet. Enter a single IPv6 address instead." };
      const ip = parseIpv4(pieces[0]);
      const prefix = Number(pieces[1]);
      if (!ip) return { entries, normalized: entries.join("\n"), estimatedAddresses, corrections, error: `Invalid IPv4 address in ${raw}.` };
      if (!/^\d{1,2}$/.test(pieces[1]) || prefix < 0 || prefix > 32) return { entries, normalized: entries.join("\n"), estimatedAddresses, corrections, error: `Invalid prefix in ${raw}. IPv4 prefixes must be /0 through /32.` };
      const hostSize = 2 ** (32 - prefix);
      const network = Math.floor(ipv4Number(ip) / hostSize) * hostSize;
      normalized = `${numberToIpv4(network)}/${prefix}`;
      addressCount = hostSize;
    } else if (raw.includes("-")) {
      const [startText, endText, extra] = raw.split("-");
      const start = parseIpv4(startText);
      if (start && !extra) {
        const end = endText.includes(".") ? parseIpv4(endText) : /^\d{1,3}$/.test(endText) && Number(endText) <= 255 ? [...start.slice(0, 3), Number(endText)] : null;
        if (!end) return { entries, normalized: entries.join("\n"), estimatedAddresses, corrections, error: `Invalid ending address in range ${raw}. Use a valid IPv4 address or final octet from 0 to 255.` };
        const startNumber = ipv4Number(start);
        const endNumber = ipv4Number(end);
        if (startNumber > endNumber) return { entries, normalized: entries.join("\n"), estimatedAddresses, corrections, error: `Range ${raw} is reversed. The ending address must be greater than or equal to the starting address.` };
        addressCount = endNumber - startNumber + 1;
        if (addressCount > 4096) return { entries, normalized: entries.join("\n"), estimatedAddresses, corrections, error: `Range ${raw} contains ${addressCount.toLocaleString()} addresses. A single range is limited to 4,096.` };
        normalized = `${numberToIpv4(startNumber)}-${numberToIpv4(endNumber)}`;
      } else if (/^[\d.-]+$/.test(raw)) {
        return { entries, normalized: entries.join("\n"), estimatedAddresses, corrections, error: `Invalid IPv4 range: ${raw}.` };
      }
    } else if (/^[\d.]+$/.test(raw) && !parseIpv4(raw)) {
      return { entries, normalized: entries.join("\n"), estimatedAddresses, corrections, error: `Invalid IPv4 address: ${raw}.` };
    }

    if (raw.length > 253 || !/^[a-zA-Z0-9.\-:/]+$/.test(raw)) return { entries, normalized: entries.join("\n"), estimatedAddresses, corrections, error: `Invalid target: ${raw}.` };
    if (normalized !== raw) corrections.push({ from: raw, to: normalized });
    if (!entries.includes(normalized)) {
      entries.push(normalized);
      estimatedAddresses += addressCount;
    }
  }

  return { entries, normalized: entries.join("\n"), estimatedAddresses, corrections };
}

export function mergeScanHost(hosts: ScanHost[], update: ScanHost) {
  const existing = hosts.find((host) => host.address === update.address);
  const ports = [...(existing?.ports ?? []), ...update.ports]
    .filter((port, index, all) => all.findIndex((candidate) => candidate.port === port.port && candidate.protocol === port.protocol) === index)
    .sort((left, right) => left.port - right.port);
  const merged: ScanHost = {
    ...existing,
    ...update,
    hostname: update.hostname || existing?.hostname,
    macAddress: update.macAddress || existing?.macAddress,
    vendor: update.vendor || existing?.vendor,
    ports,
  };
  return [...hosts.filter((host) => host.address !== update.address), merged]
    .sort((left, right) => left.address.localeCompare(right.address, undefined, { numeric: true }));
}
