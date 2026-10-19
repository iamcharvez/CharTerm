import { Channel, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  CheckCircle2,
  Copy,
  FileUp,
  Gauge,
  LoaderCircle,
  Play,
  Radio,
  ShieldCheck,
  Square,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";

type Protocol = "zmodem" | "xmodem" | "ymodem" | "kermit";
type Direction = "send" | "receive";
type TransferStatus = "idle" | "starting" | "active" | "complete" | "cancelled" | "error";

type TransferEvent =
  | { event: "started"; protocol: string; direction: string; fileName: string; totalBytes: number | null }
  | { event: "file"; fileName: string; totalBytes: number | null }
  | { event: "progress"; transferredBytes: number; totalBytes: number | null; bytesPerSecond: number; elapsedMs: number }
  | { event: "completed"; transferredBytes: number; elapsedMs: number }
  | { event: "cancelled" }
  | { event: "error"; message: string };

type Props = {
  sessionId: string;
  sessionKind: string;
  ready: boolean;
  open: boolean;
  onClose: () => void;
  onActiveChange: (active: boolean) => void;
};

const protocols: Array<{ id: Protocol; name: string; detail: string; badge?: string }> = [
  { id: "zmodem", name: "ZMODEM", detail: "Fast, resumable-style terminal transfer", badge: "Recommended" },
  { id: "xmodem", name: "XMODEM", detail: "Maximum legacy device compatibility" },
  { id: "ymodem", name: "YMODEM", detail: "File name and size metadata" },
  { id: "kermit", name: "Kermit", detail: "Reliable packet transfer in server mode" },
];

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** index;
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function fileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "transfer.bin";
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function helperCommand(protocol: Protocol, direction: Direction, remoteName: string, localPath: string) {
  const target = remoteName.trim() || fileName(localPath);
  if (direction === "send") {
    if (protocol === "zmodem") return "rz";
    if (protocol === "xmodem") return `rx ${shellQuote(target)}`;
    if (protocol === "ymodem") return "rb";
    return "kermit -x";
  }
  if (!target) return "";
  if (protocol === "zmodem") return `sz ${shellQuote(target)}`;
  if (protocol === "xmodem") return `sx ${shellQuote(target)}`;
  if (protocol === "ymodem") return `sb ${shellQuote(target)}`;
  return "kermit -x";
}

export function TerminalTransferPanel({ sessionId, sessionKind, ready, open: visible, onClose, onActiveChange }: Props) {
  const [protocol, setProtocol] = useState<Protocol>("zmodem");
  const [direction, setDirection] = useState<Direction>("send");
  const [path, setPath] = useState("");
  const [remoteName, setRemoteName] = useState("");
  const [runHelper, setRunHelper] = useState(["ssh", "local"].includes(sessionKind));
  const [customCommand, setCustomCommand] = useState<string | null>(null);
  const [status, setStatus] = useState<TransferStatus>("idle");
  const [transferId, setTransferId] = useState("");
  const [activeFile, setActiveFile] = useState("");
  const [transferred, setTransferred] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [speed, setSpeed] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const active = status === "starting" || status === "active";
  const unsupported = ["telnet", "sftp"].includes(sessionKind);
  const generatedCommand = useMemo(
    () => helperCommand(protocol, direction, remoteName, path),
    [protocol, direction, remoteName, path],
  );
  const command = customCommand ?? generatedCommand;
  const percent = total && total > 0 ? Math.min(100, (transferred / total) * 100) : 0;

  const resetResult = () => {
    if (active) return;
    setStatus("idle");
    setError("");
    setTransferred(0);
    setTotal(null);
    setSpeed(0);
    setElapsed(0);
  };

  const choosePath = async (): Promise<string | null> => {
    if (active) return null;
    if (direction === "send") {
      const selected = await open({ multiple: false, directory: false, title: `Choose a file to send with ${protocol.toUpperCase()}` });
      if (typeof selected === "string") {
        setPath(selected);
        if (!remoteName) setRemoteName(fileName(selected));
        setCustomCommand(null);
        return selected;
      }
      return null;
    }
    const selected = await save({
      title: `Save the ${protocol.toUpperCase()} download`,
      defaultPath: remoteName.trim() || "download.bin",
    });
    if (typeof selected === "string") {
      setPath(selected);
      return selected;
    }
    return null;
  };

  const start = async () => {
    if (!ready || unsupported || active) return;
    let selectedPath = path;
    if (!selectedPath) {
      selectedPath = await choosePath() ?? "";
      if (!selectedPath) return;
    }
    if (direction === "receive" && protocol === "kermit" && !remoteName.trim()) {
      setError("Enter the remote file name for a Kermit download.");
      setStatus("error");
      return;
    }
    const id = crypto.randomUUID();
    setTransferId(id);
    setStatus("starting");
    setError("");
    setTransferred(0);
    setTotal(null);
    setSpeed(0);
    setElapsed(0);
    onActiveChange(true);
    const onEvent = new Channel<TransferEvent>();
    onEvent.onmessage = (event) => {
      if (event.event === "started") {
        setStatus("active");
        setActiveFile(event.fileName);
        setTotal(event.totalBytes);
      } else if (event.event === "file") {
        setActiveFile(event.fileName);
        setTotal(event.totalBytes);
      } else if (event.event === "progress") {
        setStatus("active");
        setTransferred(event.transferredBytes);
        setTotal(event.totalBytes);
        setSpeed(event.bytesPerSecond);
        setElapsed(event.elapsedMs);
      } else if (event.event === "completed") {
        setStatus("complete");
        setTransferred(event.transferredBytes);
        setElapsed(event.elapsedMs);
        onActiveChange(false);
      } else if (event.event === "cancelled") {
        setStatus("cancelled");
        onActiveChange(false);
      } else if (event.event === "error") {
        setStatus("error");
        setError(event.message);
        onActiveChange(false);
      }
    };
    try {
      await invoke("start_terminal_transfer", {
        transferId: id,
        sessionId,
        sessionKind,
        protocol,
        direction,
        path: selectedPath,
        remoteName: remoteName.trim() || null,
        remoteCommand: runHelper ? command.trim() || null : null,
        onEvent,
      });
    } catch (reason) {
      setStatus("error");
      setError(String(reason));
      onActiveChange(false);
    }
  };

  const cancel = async () => {
    if (!transferId) return;
    try {
      await invoke("cancel_terminal_transfer", { transferId });
    } catch (reason) {
      setError(String(reason));
    }
  };

  return (
    <aside className={`terminal-transfer-panel ${visible ? "open" : ""}`} aria-hidden={!visible}>
      <header>
        <div>
          <span><Radio size={17} /></span>
          <div><strong>Terminal Transfer</strong><small>Native modem protocols</small></div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close Transfer Center"><X size={18} /></button>
      </header>

      <div className="transfer-panel-scroll">
        {unsupported && (
          <div className="transfer-notice warning">
            <AlertTriangle size={17} />
            <span><strong>Use a binary-safe session</strong><small>{sessionKind === "telnet" ? "Telnet can alter binary control bytes. Open SSH, Serial, or raw TCP instead." : "SFTP already has its own complete file manager."}</small></span>
          </div>
        )}

        <section className="transfer-section">
          <div className="transfer-section-title"><span>1</span><div><strong>Protocol</strong><small>Choose what the remote device supports</small></div></div>
          <div className="transfer-protocol-grid">
            {protocols.map((item) => (
              <button
                type="button"
                key={item.id}
                className={protocol === item.id ? "active" : ""}
                disabled={active}
                onClick={() => { setProtocol(item.id); setCustomCommand(null); resetResult(); }}
              >
                <span><Zap size={15} /></span>
                <strong>{item.name}</strong>
                <small>{item.detail}</small>
                {item.badge && <em>{item.badge}</em>}
              </button>
            ))}
          </div>
        </section>

        <section className="transfer-section">
          <div className="transfer-section-title"><span>2</span><div><strong>Direction & file</strong><small>CharTerm transfers on the current live session</small></div></div>
          <div className="transfer-direction-switch">
            <button type="button" className={direction === "send" ? "active" : ""} disabled={active} onClick={() => { setDirection("send"); setPath(""); setCustomCommand(null); resetResult(); }}><ArrowUpToLine size={16} /> Send</button>
            <button type="button" className={direction === "receive" ? "active" : ""} disabled={active} onClick={() => { setDirection("receive"); setPath(""); setCustomCommand(null); resetResult(); }}><ArrowDownToLine size={16} /> Receive</button>
          </div>
          <button className="transfer-file-picker" type="button" disabled={active} onClick={() => void choosePath()}>
            <FileUp size={20} />
            <span><strong>{path ? fileName(path) : direction === "send" ? "Choose a local file" : "Choose where to save"}</strong><small>{path || "No file selected"}</small></span>
            <b>Browse</b>
          </button>
          <label className="transfer-field">
            <span>{direction === "send" ? "Remote file name" : "Remote file to request"}<small>{protocol === "kermit" && direction === "receive" ? "Required" : "Used to prepare the remote helper"}</small></span>
            <input value={remoteName} disabled={active} onChange={(event) => { setRemoteName(event.target.value); setCustomCommand(null); }} placeholder={direction === "send" ? "Defaults to the local file name" : "example.bin"} />
          </label>
        </section>

        <section className="transfer-section">
          <div className="transfer-section-title"><span>3</span><div><strong>Remote helper</strong><small>Optional for shell-based SSH and local sessions</small></div></div>
          <label className="transfer-helper-toggle">
            <input type="checkbox" checked={runHelper} disabled={active || !["ssh", "local"].includes(sessionKind)} onChange={(event) => setRunHelper(event.target.checked)} />
            <span><strong>Start the remote helper automatically</strong><small>CharTerm sends this command before beginning the protocol.</small></span>
          </label>
          <div className="transfer-command-row">
            <code>{command || "Enter a remote file name to build the command"}</code>
            <button type="button" disabled={!command} onClick={() => void navigator.clipboard.writeText(command)} title="Copy helper command"><Copy size={15} /></button>
          </div>
          {runHelper && (
            <label className="transfer-field compact">
              <span>Command <small>Editable</small></span>
              <input value={command} disabled={active} onChange={(event) => setCustomCommand(event.target.value)} />
            </label>
          )}
          {!runHelper && <p className="transfer-peer-note">Put the peer in {direction === "send" ? "receive" : "send"} mode first, then start here. Kermit expects the peer in server mode.</p>}
        </section>

        {(status !== "idle" || active) && (
          <section className={`transfer-progress-card ${status}`} aria-live="polite">
            <header>
              <span>{active ? <LoaderCircle className="spin" size={18} /> : status === "complete" ? <CheckCircle2 size={18} /> : status === "error" ? <AlertTriangle size={18} /> : <Square size={18} />}</span>
              <div><strong>{status === "starting" ? "Preparing transfer" : status === "active" ? `Transferring ${activeFile || fileName(path)}` : status === "complete" ? "Transfer complete" : status === "cancelled" ? "Transfer cancelled" : "Transfer stopped"}</strong><small>{protocol.toUpperCase()} · {direction}</small></div>
              {active && <button type="button" onClick={() => void cancel()}><Square size={13} /> Stop</button>}
            </header>
            {error ? <p className="transfer-error"><AlertTriangle size={15} /> {error}</p> : (
              <>
                <div className={`transfer-progress-track ${total ? "" : "indeterminate"}`}><i style={total ? { width: `${percent}%` } : undefined} /></div>
                <div className="transfer-stats">
                  <span><b>{total ? `${percent.toFixed(0)}%` : formatBytes(transferred)}</b><small>{total ? `${formatBytes(transferred)} of ${formatBytes(total)}` : "Transferred"}</small></span>
                  <span><b>{formatBytes(speed)}/s</b><small><Gauge size={11} /> Current speed</small></span>
                  <span><b>{(elapsed / 1000).toFixed(1)}s</b><small>Elapsed</small></span>
                </div>
              </>
            )}
          </section>
        )}

        <div className="transfer-safety-note"><ShieldCheck size={15} /><span>The transfer runs in a background worker. Normal terminal rendering resumes automatically when it finishes.</span></div>
      </div>

      <footer>
        <button type="button" className="transfer-secondary" onClick={onClose}>{active ? "Run in background" : "Close"}</button>
        <button type="button" className="transfer-start" disabled={!ready || unsupported || active || (direction === "receive" && protocol === "kermit" && !remoteName.trim())} onClick={() => void start()}>
          {active ? <><LoaderCircle className="spin" size={16} /> Transferring</> : <><Play size={16} /> {path ? `Start ${direction}` : `Choose & ${direction}`}</>}
        </button>
      </footer>
    </aside>
  );
}
