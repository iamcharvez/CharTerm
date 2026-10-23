import { Channel, invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Clipboard, Copy, DatabaseZap, Power, Radio, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadPreferences } from "../../lib/preferences";
import { recordActivity } from "../../lib/activityLog";
import { removeNativeConnection, updateNativeConnection } from "../../lib/nativeCore";
import { detectLegacyCompatibility } from "../../lib/sshCompatibility";
import { createSftpCompanion } from "../../lib/sftpCompanion";
import {
  useAppStore,
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
  const closeTerminal = useAppStore((state) => state.closeTerminal);
  const openConnection = useAppStore((state) => state.openConnection);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const readyRef = useRef(false);
  const transferActiveRef = useRef(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferActive, setTransferActive] = useState(false);
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
          const text = new TextDecoder(tab.connection?.serialEncoding ?? "utf-8").decode(Uint8Array.from(message.data));
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
          if (tab.kind === "serial" && tab.connection?.serialEncoding && tab.connection.serialEncoding !== "utf-8") {
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
  }, [sessionId, tab.connection, tab.kind, tab.sessionKeyPassphrase, identity]);

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
