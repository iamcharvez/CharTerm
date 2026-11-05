import { Channel, invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Check, Clipboard, Copy, DatabaseZap, Gauge, Power, Radio, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadPreferences } from "../../lib/preferences";
import { recordActivity } from "../../lib/activityLog";
import { removeNativeConnection, updateNativeConnection } from "../../lib/nativeCore";
import { detectLegacyCompatibility } from "../../lib/sshCompatibility";
import { createSftpCompanion } from "../../lib/sftpCompanion";
import { baudRateGroups, commonBaudRates, serialFormatLabel } from "../../lib/serialSettings";
import {
  useAppStore,
  type SerialEncoding,
  type SerialFlowControl,
  type SerialParity,
  type TerminalTab,
} from "../../stores/useAppStore";
import { TerminalTransferPanel } from "./TerminalTransferPanel";

type TerminalEvent =
  | { event: "output"; data: number[] }
  | { event: "exit" }
  | { event: "error"; message: string };

type TerminalPaneProps = {
  tab: TerminalTab;
  active: boolean;
  pageActive: boolean;
  layoutKey: string;
};

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function TerminalPane({ tab, active, pageActive, layoutKey }: TerminalPaneProps) {
  const sessionId = tab.id;
  const identity = useAppStore((state) =>
    state.identities.find((item) => item.id === tab.connection?.identityId),
  );
  const enableLegacyCompatibility = useAppStore(
    (state) => state.enableLegacyCompatibility,
  );
  const setSessionUsername = useAppStore((state) => state.setSessionUsername);
  const updateSerialSessionSettings = useAppStore((state) => state.updateSerialSessionSettings);
  const closeTerminal = useAppStore((state) => state.closeTerminal);
  const openConnection = useAppStore((state) => state.openConnection);
  const isSavedSerialProfile = useAppStore((state) =>
    Boolean(tab.connection && state.profiles.some((profile) => profile.id === tab.connection?.id)),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const readyRef = useRef(false);
  const transferActiveRef = useRef(false);
  const serialEncodingRef = useRef<SerialEncoding>(tab.connection?.serialEncoding ?? "utf-8");
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferActive, setTransferActive] = useState(false);
  const [showSerialSettings, setShowSerialSettings] = useState(false);
  const [serialBaudRate, setSerialBaudRate] = useState(String(tab.connection?.baudRate ?? 115200));
  const [serialDataBits, setSerialDataBits] = useState<5 | 6 | 7 | 8>(tab.connection?.serialDataBits ?? 8);
  const [serialStopBits, setSerialStopBits] = useState<1 | 2>(tab.connection?.serialStopBits ?? 1);
  const [serialParity, setSerialParity] = useState<SerialParity>(tab.connection?.serialParity ?? "none");
  const [serialFlowControl, setSerialFlowControl] = useState<SerialFlowControl>(tab.connection?.serialFlowControl ?? "none");
  const [serialEncoding, setSerialEncoding] = useState<SerialEncoding>(tab.connection?.serialEncoding ?? "utf-8");
  const [saveSerialDefault, setSaveSerialDefault] = useState(false);
  const [serialSettingsBusy, setSerialSettingsBusy] = useState(false);
  const [serialSettingsError, setSerialSettingsError] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "waiting" | "starting" | "active" | "closed" | "error"
  >("starting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setStatus("starting");
    setError(null);
    void updateNativeConnection(sessionId, tab.kind, `${tab.kind.toUpperCase()} session`, "starting");

    const preferences = loadPreferences();
    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      cursorStyle: preferences.cursorStyle,
      fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
      fontSize: preferences.fontSize,
      lineHeight: 1.2,
      scrollback: preferences.scrollback,
      theme: {
        background: "#050b11",
        foreground: "#dce7ef",
        cursor: "#67e8f9",
        cursorAccent: "#050b11",
        selectionBackground: "#164e63",
        black: "#071019",
        brightBlack: "#60798a",
        red: "#f87171",
        brightRed: "#fca5a5",
        green: "#34d399",
        brightGreen: "#6ee7b7",
        yellow: "#fbbf24",
        brightYellow: "#fde68a",
        blue: "#60a5fa",
        brightBlue: "#93c5fd",
        magenta: "#c084fc",
        brightMagenta: "#d8b4fe",
        cyan: "#22d3ee",
        brightCyan: "#67e8f9",
        white: "#dce7ef",
        brightWhite: "#f8fafc",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    fit.fit();
    terminalRef.current = terminal;
    fitRef.current = fit;

    let disposed = false;
    const awaitingUsername = tab.kind === "ssh" && !tab.connection?.username;
    let usernameBuffer = "";
    let legacyNegotiationFailed = false;
    let autoRetryScheduled = false;
    let outputTail = "";
    const inputSubscription = terminal.onData((data) => {
      if (transferActiveRef.current) {
        terminal.write("\x07");
        return;
      }
      if (awaitingUsername) {
        for (const character of data) {
          if (character === "\r" || character === "\n") {
            const username = usernameBuffer.trim();
            if (username) {
              terminal.write("\r\n");
              setSessionUsername(sessionId, username);
            } else {
              terminal.write("\x07");
            }
            return;
          }
          if (character === "\x7f" || character === "\b") {
            if (usernameBuffer.length > 0) {
              usernameBuffer = usernameBuffer.slice(0, -1);
              terminal.write("\b \b");
            }
            continue;
          }
          if (/^[a-zA-Z0-9._-]$/.test(character) && usernameBuffer.length < 64) {
            usernameBuffer += character;
            terminal.write(character);
          }
        }
        return;
      }
      if (!readyRef.current) return;
      const command = tab.kind === "serial"
        ? "write_serial_terminal"
        : tab.kind === "telnet"
          ? "write_telnet_terminal"
          : tab.kind === "tcp"
            ? "write_tcp_terminal"
          : "write_local_terminal";
      void invoke(command, { sessionId, data }).catch(
        (reason) => {
          setError(String(reason));
          setStatus("error");
        },
      );
    });

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (disposed) return;
        const bounds = container.getBoundingClientRect();
        if (bounds.width < 240 || bounds.height < 120) return;
        fit.fit();
        if (readyRef.current && !["serial", "telnet", "tcp"].includes(tab.kind)) {
          void invoke("resize_local_terminal", {
            sessionId,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        }
      });
    });
    resizeObserver.observe(container);

    if (awaitingUsername) {
      setStatus("waiting");
      terminal.write("\x1b[36mlogin as:\x1b[0m ");
      terminal.focus();
    } else if (!isTauriRuntime()) {
      terminal.writeln(
        "\x1b[33mCharTerm connections require the desktop application.\x1b[0m",
      );
      terminal.writeln(
        "Run \x1b[36mnpm run tauri dev\x1b[0m to start the native runtime.",
      );
      setStatus("error");
      setError("Desktop runtime required");
    } else {
      const onEvent = new Channel<TerminalEvent>();
      onEvent.onmessage = (message) => {
        if (disposed) return;
        if (message.event === "output") {
          const text = new TextDecoder(serialEncodingRef.current).decode(Uint8Array.from(message.data));
          outputTail = `${outputTail}${text}`.slice(-1024);
          const detection =
            tab.kind === "ssh"
              ? detectLegacyCompatibility(outputTail, tab.connection)
              : null;
          if (detection && !autoRetryScheduled) {
            autoRetryScheduled = true;
            legacyNegotiationFailed = true;
            setStatus("starting");
            setError(detection.message);
            void invoke("close_local_terminal", { sessionId })
              .catch(() => undefined)
              .then(() => {
                if (!disposed) {
                  enableLegacyCompatibility(
                    sessionId,
                    detection.compatibility,
                  );
                }
              });
          }
          if (tab.kind === "serial" && serialEncodingRef.current !== "utf-8") {
            terminal.write(text);
          } else {
            terminal.write(Uint8Array.from(message.data));
          }
        }
        if (message.event === "exit") {
          readyRef.current = false;
          if (!legacyNegotiationFailed) setStatus("closed");
          void updateNativeConnection(sessionId, tab.kind, `${tab.kind.toUpperCase()} session`, "closed");
          terminal.writeln("\r\n\x1b[90m[Process exited]\x1b[0m");
        }
        if (message.event === "error") {
          setError(message.message);
          setStatus("error");
          void updateNativeConnection(sessionId, tab.kind, `${tab.kind.toUpperCase()} session`, "error", message.message);
        }
      };

      const connection = tab.connection;
      const createCommand = tab.kind === "local"
        ? "create_local_terminal"
        : tab.kind === "ssh"
          ? "create_ssh_terminal"
          : tab.kind === "sftp"
            ? "create_sftp_terminal"
            : tab.kind === "telnet"
              ? "create_telnet_terminal"
              : tab.kind === "tcp"
                ? "create_tcp_terminal"
              : "create_serial_terminal";
      const createArguments = tab.kind === "local"
        ? { sessionId, cols: terminal.cols, rows: terminal.rows, workingDirectory: null, onEvent }
        : tab.kind === "serial"
          ? {
              sessionId,
              portName: connection?.serialPort,
              baudRate: connection?.baudRate,
              dataBits: connection?.serialDataBits ?? 8,
              stopBits: connection?.serialStopBits ?? 1,
              parity: connection?.serialParity ?? "none",
              flowControl: connection?.serialFlowControl ?? "none",
              onEvent,
            }
          : {
              sessionId,
              cols: terminal.cols,
              rows: terminal.rows,
              host: connection?.host,
              port: connection?.port,
              username: connection?.username ?? "",
              connectionTimeout: preferences.connectionTimeout,
              keepaliveSeconds: preferences.keepaliveSeconds,
              allowLegacySshRsa: connection?.allowLegacySshRsa ?? false,
              allowLegacyMacSha1: connection?.allowLegacyMacSha1 ?? false,
              allowLegacyKexSha1: connection?.allowLegacyKexSha1 ?? false,
              allowLegacyCiphers: connection?.allowLegacyCiphers ?? false,
              password: tab.sessionPassword ?? null,
              credentialId: connection?.hasSavedPassword
                ? connection.id
                : null,
              authenticationMode: connection?.authenticationMode ?? "auto",
              privateKeyPath: identity?.privateKeyPath ?? null,
              certificatePath: identity?.certificatePath ?? null,
              keyPassphrase: tab.sessionKeyPassphrase ?? null,
              identityId: identity?.hasSavedPassphrase ? identity.id : null,
              jumpHost: connection?.jumpHost ?? null,
              jumpPort: connection?.jumpPort ?? null,
              jumpUsername: connection?.jumpUsername ?? null,
              startupCommand: connection?.startupCommand ?? null,
              enableCompression: connection?.enableCompression ?? false,
              agentForwarding: connection?.agentForwarding ?? false,
              localForward: connection?.localForward ?? null,
              remoteForward: connection?.remoteForward ?? null,
              dynamicForward: connection?.dynamicForward ?? null,
              onEvent,
            };

      void invoke(createCommand, createArguments)
        .then(() => {
          if (disposed) {
            void invoke(tab.kind === "serial" ? "close_serial_terminal" : tab.kind === "telnet" ? "close_telnet_terminal" : tab.kind === "tcp" ? "close_tcp_terminal" : "close_local_terminal", { sessionId });
            return;
          }
          readyRef.current = true;
          setStatus("active");
          void recordActivity("info", "connection", "Terminal session connected", {
            protocol: tab.kind,
          });
          void updateNativeConnection(sessionId, tab.kind, `${tab.kind.toUpperCase()} session`, "active");
          terminal.focus();
        })
        .catch((reason) => {
          const message = String(reason);
          setError(message);
          setStatus("error");
          void recordActivity("error", "connection", "Terminal session failed", {
            protocol: tab.kind,
          });
          void updateNativeConnection(sessionId, tab.kind, `${tab.kind.toUpperCase()} session`, "error", message);
          terminal.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
        });
    }

    return () => {
      disposed = true;
      readyRef.current = false;
      resizeObserver.disconnect();
      inputSubscription.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      if (isTauriRuntime())
        void invoke(tab.kind === "serial" ? "close_serial_terminal" : tab.kind === "telnet" ? "close_telnet_terminal" : tab.kind === "tcp" ? "close_tcp_terminal" : "close_local_terminal", { sessionId });
      void removeNativeConnection(sessionId);
    };
  }, [sessionId, tab.kind === "serial" ? null : tab.connection, tab.kind, tab.sessionKeyPassphrase, identity]);

  useEffect(() => {
    serialEncodingRef.current = tab.connection?.serialEncoding ?? "utf-8";
  }, [tab.connection?.serialEncoding]);

  useEffect(() => {
    if (!active || !pageActive) {
      terminalRef.current?.blur();
      return;
    }
    let cancelled = false;
    let secondFrame = 0;
    let delayedFit = 0;
    const restoreTerminal = () => {
      if (cancelled) return;
      const container = containerRef.current;
      const fit = fitRef.current;
      const terminal = terminalRef.current;
      if (!container || !fit || !terminal) return;
      const bounds = container.getBoundingClientRect();
      if (bounds.width < 240 || bounds.height < 120) return;

      fit.fit();
      terminal.refresh(0, Math.max(0, terminal.rows - 1));
      if (readyRef.current && !["serial", "telnet", "tcp"].includes(tab.kind)) {
        void invoke("resize_local_terminal", {
          sessionId,
          cols: terminal.cols,
          rows: terminal.rows,
        }).catch(() => undefined);
      }
      terminal.focus();
    };
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        restoreTerminal();
        delayedFit = window.setTimeout(restoreTerminal, 120);
      });
    });
    const restoreOnWindowFocus = () => restoreTerminal();
    window.addEventListener("focus", restoreOnWindowFocus);

    return () => {
      cancelled = true;
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
      if (delayedFit) window.clearTimeout(delayedFit);
      window.removeEventListener("focus", restoreOnWindowFocus);
    };
  }, [active, pageActive, layoutKey, sessionId, tab.kind]);

  const copySelection = async () => {
    const selection = terminalRef.current?.getSelection();
    if (selection) await navigator.clipboard.writeText(selection);
  };

  const pasteClipboard = async () => {
    if (transferActiveRef.current) return;
    const text = await navigator.clipboard.readText();
    if (readyRef.current)
      await invoke(tab.kind === "serial" ? "write_serial_terminal" : tab.kind === "telnet" ? "write_telnet_terminal" : tab.kind === "tcp" ? "write_tcp_terminal" : "write_local_terminal", { sessionId, data: text });
  };

  const openSftpCompanion = () => {
    if (tab.kind !== "ssh" || !tab.connection?.host) return;
    openConnection(
      createSftpCompanion(tab.connection),
      tab.sessionPassword,
      tab.sessionKeyPassphrase,
    );
  };

  const applySerialSettings = async () => {
    if (tab.kind !== "serial") return;
    const baudRate = Number(serialBaudRate);
    if (!Number.isInteger(baudRate) || baudRate < 50 || baudRate > 4_000_000) {
      setSerialSettingsError("Enter a baud rate from 50 to 4,000,000.");
      return;
    }
    setSerialSettingsBusy(true);
    setSerialSettingsError(null);
    try {
      await invoke("reconfigure_serial_terminal", {
        sessionId,
        baudRate,
        dataBits: serialDataBits,
        stopBits: serialStopBits,
        parity: serialParity,
        flowControl: serialFlowControl,
      });
      serialEncodingRef.current = serialEncoding;
      updateSerialSessionSettings(sessionId, {
        baudRate,
        serialDataBits,
        serialStopBits,
        serialParity,
        serialFlowControl,
        serialEncoding,
      }, saveSerialDefault);
      setShowSerialSettings(false);
      setError(null);
      terminalRef.current?.writeln(`\r\n\x1b[36m[Serial updated: ${serialFormatLabel(baudRate, serialDataBits, serialParity, serialStopBits)}]\x1b[0m`);
      terminalRef.current?.focus();
    } catch (reason) {
      setSerialSettingsError(String(reason));
    } finally {
      setSerialSettingsBusy(false);
    }
  };

  return (
    <section
      className={`terminal-pane ${active ? "active" : ""}`}
      aria-hidden={!active || !pageActive}
    >
      <div className="terminal-toolbar">
        <div className={`terminal-connection-state ${status}`}>
          <span />
          {status}
        </div>
        <div>
          {tab.kind === "ssh" && (
            <button
              type="button"
              onClick={openSftpCompanion}
              title="Open this SSH server in a new SFTP files tab"
              disabled={status !== "active"}
            >
              <DatabaseZap size={15} /> SFTP Files
            </button>
          )}
          {tab.kind === "serial" && (
            <button
              type="button"
              onClick={() => {
                setSerialSettingsError(null);
                setShowSerialSettings((value) => !value);
              }}
              title="Change serial speed and line settings without closing this session"
              disabled={status !== "active"}
            >
              <Gauge size={15} /> {(tab.connection?.baudRate ?? 115200).toLocaleString()} baud
            </button>
          )}
          <button
            className={transferActive ? "transfer-running" : ""}
            type="button"
            onClick={() => setShowTransfer(true)}
            title="Open XMODEM, YMODEM, ZMODEM, and Kermit transfer"
            disabled={!readyRef.current || ["telnet", "sftp"].includes(tab.kind)}
          >
            <Radio size={15} /> X/Y/Z Transfer
            {transferActive && <span className="transfer-live-dot" />}
          </button>
          <button
            type="button"
            onClick={() => void copySelection()}
            title="Copy selection"
          >
            <Copy size={15} /> Copy
          </button>
          <button
            type="button"
            onClick={() => void pasteClipboard()}
            title="Paste"
          >
            <Clipboard size={15} /> Paste
          </button>
          <button
            type="button"
            onClick={() => {
              terminalRef.current?.clear();
              terminalRef.current?.focus();
            }}
            title="Clear terminal"
          >
            <RotateCcw size={15} /> Clear
          </button>
          <button
            className="terminal-disconnect"
            type="button"
            onClick={() => closeTerminal(sessionId)}
            title="Disconnect and close this session"
          >
            <Power size={15} /> Disconnect
          </button>
        </div>
      </div>
      {tab.kind === "serial" && showSerialSettings && (
        <form className="serial-live-settings" onSubmit={(event) => { event.preventDefault(); void applySerialSettings(); }}>
          <header>
            <div><span>Live serial settings</span><strong>{tab.connection?.serialPort}</strong><small>Changes apply to this open tab immediately.</small></div>
            <button type="button" onClick={() => setShowSerialSettings(false)} aria-label="Close serial settings"><X size={16} /></button>
          </header>
          <div className="serial-live-speed-grid">
            <label className="field"><span>Common speed</span><select aria-label="Active serial speed preset" value={commonBaudRates.includes(Number(serialBaudRate)) ? serialBaudRate : "custom"} onChange={(event) => setSerialBaudRate(event.target.value === "custom" ? "" : event.target.value)}>{baudRateGroups.map((group) => <optgroup key={group.label} label={group.label}>{group.rates.map((rate) => <option key={rate} value={rate}>{rate.toLocaleString()} baud</option>)}</optgroup>)}<option value="custom">Custom speed…</option></select></label>
            <label className="field"><span>Manual baud rate</span><input aria-label="Active manual serial speed" inputMode="numeric" value={serialBaudRate} onChange={(event) => setSerialBaudRate(event.target.value.replace(/[^0-9]/g, ""))} placeholder="115200" /></label>
          </div>
          <div className="serial-live-options">
            <div className="serial-option"><span>Data bits</span><div>{([8, 7, 6, 5] as const).map((value) => <button className={serialDataBits === value ? "active" : ""} type="button" key={value} onClick={() => setSerialDataBits(value)}>{value}</button>)}</div></div>
            <div className="serial-option"><span>Stop bits</span><div>{([1, 2] as const).map((value) => <button className={serialStopBits === value ? "active" : ""} type="button" key={value} onClick={() => setSerialStopBits(value)}>{value}</button>)}</div></div>
            <div className="serial-option"><span>Parity</span><div>{(["none", "odd", "even"] as const).map((value) => <button className={serialParity === value ? "active" : ""} type="button" key={value} onClick={() => setSerialParity(value)}>{value === "none" ? "None" : value[0].toUpperCase() + value.slice(1)}</button>)}</div></div>
            <label className="field"><span>Flow control</span><select value={serialFlowControl} onChange={(event) => setSerialFlowControl(event.target.value as SerialFlowControl)}><option value="none">None</option><option value="hardware">RTS/CTS</option><option value="software">XON/XOFF</option></select></label>
            <label className="field"><span>Character encoding</span><select value={serialEncoding} onChange={(event) => setSerialEncoding(event.target.value as SerialEncoding)}><option value="utf-8">UTF-8</option><option value="windows-1252">Windows-1252</option><option value="iso-8859-1">ISO-8859-1 / Latin-1</option></select></label>
          </div>
          {isSavedSerialProfile && <label className="serial-live-save"><input type="checkbox" checked={saveSerialDefault} onChange={(event) => setSaveSerialDefault(event.target.checked)} /> Use these settings next time for this saved connection</label>}
          {serialSettingsError && <div className="serial-live-error">{serialSettingsError}</div>}
          <footer><span>{serialBaudRate ? serialFormatLabel(Number(serialBaudRate), serialDataBits, serialParity, serialStopBits) : "Enter a speed"}</span><button type="button" onClick={() => setShowSerialSettings(false)}>Cancel</button><button className="primary-action" type="submit" disabled={serialSettingsBusy}><Check size={14} /> {serialSettingsBusy ? "Applying…" : "Apply live"}</button></footer>
        </form>
      )}
      {error && (
        <div className="terminal-error" role="alert">
          <span>{error}</span>
        </div>
      )}
      <div
        className="xterm-host"
        ref={containerRef}
        onPointerDown={() => {
          window.requestAnimationFrame(() => terminalRef.current?.focus());
        }}
      />
      <TerminalTransferPanel
        sessionId={sessionId}
        sessionKind={tab.kind}
        ready={status === "active"}
        open={showTransfer}
        onClose={() => setShowTransfer(false)}
        onActiveChange={(nextActive) => {
          transferActiveRef.current = nextActive;
          setTransferActive(nextActive);
          if (!nextActive) terminalRef.current?.focus();
        }}
      />
    </section>
  );
}
