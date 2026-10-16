import { Channel, invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  LoaderCircle,
  Network,
  Play,
  Radar,
  Server,
  ShieldCheck,
  Square,
  TerminalSquare,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAppStore, type ConnectionProfile } from "../../stores/useAppStore";

type ScannerStatus = { nmapAvailable: boolean; nmapVersion?: string };
type ScanPort = { port: number; protocol: string; service: string; product?: string };
type ScanHost = { address: string; hostname?: string; ports: ScanPort[] };
type ScanEvent =
  | { event: "started"; engine: string }
  | { event: "progress"; completed: number; total: number }
  | { event: "complete"; hosts: ScanHost[]; engine: string }
  | { event: "cancelled" }
  | { event: "error"; message: string };

const commonPorts = "21,22,23,25,53,80,110,135,139,143,443,445,993,995,1433,1521,3306,3389,5432,5900,6379,8080,8443";

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
  const openPortCount = useMemo(() => hosts.reduce((total, host) => total + host.ports.length, 0), [hosts]);

  const startScan = async (event: FormEvent) => {
    event.preventDefault();
    if (!target.trim()) { setError("Enter an IP address, hostname, or subnet such as 192.168.1.0/24."); return; }
    const id = crypto.randomUUID();
    setScanId(id);
    setRunning(true);
    setHosts([]);
    setError(null);
    setProgress({ completed: 0, total: 0 });
    const onEvent = new Channel<ScanEvent>();
    onEvent.onmessage = (message) => {
      if (message.event === "started") setActiveEngine(message.engine);
      if (message.event === "progress") setProgress(message);
      if (message.event === "complete") { setHosts(message.hosts); setActiveEngine(message.engine); setRunning(false); }
      if (message.event === "cancelled") { setRunning(false); setError("Scan cancelled."); }
      if (message.event === "error") { setRunning(false); setError(message.message); }
    };
    try {
      await invoke("start_network_scan", {
        request: {
          scanId: id,
          target: target.trim(),
          ports,
          engine,
          mode,
          timeoutMs: 350,
          concurrency: 96,
          serviceDetection,
        },
        onEvent,
      });
    } catch (reason) {
      setRunning(false);
      setError(String(reason));
    }
  };

  const cancelScan = async () => {
    if (scanId) await invoke("cancel_network_scan", { scanId });
  };

  const connectSsh = (host: ScanHost) => {
    const profile: ConnectionProfile = {
      id: crypto.randomUUID(), name: host.hostname || host.address, protocol: "ssh",
      host: host.address, port: 22, favorite: false, createdAt: Date.now(),
    };
    openConnection(profile);
  };

  const exportResults = () => {
    const rows = ["address,hostname,port,protocol,service,product"];
    for (const host of hosts) for (const port of host.ports) rows.push([host.address, host.hostname ?? "", port.port, port.protocol, port.service, port.product ?? ""].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
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
          <label className="field"><span>Target</span><input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="10.12.0.2 or 192.168.1.0/24" disabled={running} autoFocus /></label>
          <div className="scanner-field-grid">
            <label className="field"><span>Engine</span><select value={engine} onChange={(event) => setEngine(event.target.value)} disabled={running}><option value="auto">Automatic</option><option value="builtin">Built-in TCP</option><option value="nmap" disabled={!status.nmapAvailable}>Nmap</option></select></label>
            <label className="field"><span>Scan type</span><select value={mode} onChange={(event) => setMode(event.target.value)} disabled={running}><option value="ports">Ports and devices</option><option value="discovery">Device discovery</option></select></label>
          </div>
          {mode === "ports" && <>
            <label className="field"><span>Ports</span><select value={portPreset} onChange={(event) => setPortPreset(event.target.value)} disabled={running}><option value="common">Common services</option><option value="top">Quick network ports</option><option value="custom">Custom list</option></select></label>
            {portPreset === "custom" && <label className="field"><span>Custom ports</span><input value={customPorts} onChange={(event) => setCustomPorts(event.target.value)} placeholder="22,80,443,8000-8010" disabled={running} /></label>}
            <label className="scanner-check"><input type="checkbox" checked={serviceDetection} disabled={running || (engine === "builtin") || (!status.nmapAvailable && engine === "auto")} onChange={(event) => setServiceDetection(event.target.checked)} /><span><strong>Service version detection</strong><small>Available when the Nmap engine is active.</small></span></label>
          </>}
          <div className="scanner-authorized"><ShieldCheck size={16} /><span>Scanning can create connection logs and alerts on target systems.</span></div>
          {!status.nmapAvailable && <div className="scanner-engine-note">The built-in engine finds devices through open TCP ports. Install Nmap for ARP/ICMP host discovery and detailed service versions.</div>}
          {running ? <button className="scanner-stop" type="button" onClick={() => void cancelScan()}><Square size={15} /> Stop scan</button> : <button className="primary-action scanner-start" type="submit"><Play size={16} /> Start scan</button>}
        </form>

        <section className="scanner-results">
          <div className="scanner-results-header"><div><strong>Results</strong><span>{hosts.length} devices · {openPortCount} open ports{activeEngine ? ` · ${activeEngine}` : ""}</span></div>{hosts.length > 0 && <button type="button" onClick={exportResults}><Download size={15} /> Export CSV</button>}</div>
          {running && <div className="scan-progress"><div><LoaderCircle className="spin" size={18} /><span>Scanning {target}…</span><strong>{progress.total ? `${percent}%` : "Working"}</strong></div><div className="progress-track"><span style={{ width: `${percent}%` }} /></div></div>}
          {error && <div className="scanner-error"><AlertTriangle size={17} /> {error}</div>}
          {!running && !error && hosts.length === 0 && <div className="scanner-empty"><span><Network size={31} /></span><h2>No scan results yet</h2><p>Enter a device or subnet and start a scan. CIDR ranges up to /22 are supported by the built-in engine.</p></div>}
          {hosts.length > 0 && <div className="scan-hosts">
            {hosts.map((host) => <article className="scan-host" key={host.address}>
              <div className="scan-host-summary"><span><Server size={18} /></span><div><strong>{host.hostname || host.address}</strong>{host.hostname && <small>{host.address}</small>}</div><b>{host.ports.length} open</b></div>
              <div className="scan-port-list">{host.ports.length ? host.ports.map((port) => <div key={`${port.protocol}-${port.port}`}><strong>{port.port}</strong><span>{port.protocol}</span><span>{port.service}</span><small>{port.product || "—"}</small></div>) : <p>Host is online; no ports reported by this scan.</p>}</div>
              {host.ports.some((port) => port.port === 22) && <button className="scan-connect" type="button" onClick={() => connectSsh(host)}><TerminalSquare size={15} /> Connect with SSH</button>}
            </article>)}
          </div>}
        </section>
      </div>
    </main>
  );
}
