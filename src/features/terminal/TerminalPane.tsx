import { Channel, invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Clipboard, Copy, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadPreferences } from "../../lib/preferences";
import { detectLegacyCompatibility } from "../../lib/sshCompatibility";
import {
  useAppStore,
  type TerminalTab,
} from "../../stores/useAppStore";

type TerminalEvent =
  | { event: "output"; data: number[] }
  | { event: "exit" }
  | { event: "error"; message: string };

type TerminalPaneProps = { tab: TerminalTab; active: boolean };

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function TerminalPane({ tab, active }: TerminalPaneProps) {
  const sessionId = tab.id;
  const enableLegacyCompatibility = useAppStore(
    (state) => state.enableLegacyCompatibility,
  );
  const setSessionUsername = useAppStore((state) => state.setSessionUsername);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const readyRef = useRef(false);
  const [status, setStatus] = useState<
    "waiting" | "starting" | "active" | "closed" | "error"
  >("starting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setStatus("starting");
    setError(null);

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
    const awaitingUsername =
      (tab.kind === "ssh" || tab.kind === "sftp") &&
      !tab.connection?.username;
    let usernameBuffer = "";
    let legacyNegotiationFailed = false;
    let autoRetryScheduled = false;
    let outputTail = "";
    const inputSubscription = terminal.onData((data) => {
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
        fit.fit();
        if (readyRef.current && tab.kind !== "serial" && tab.kind !== "telnet") {
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
          const text = new TextDecoder().decode(Uint8Array.from(message.data));
          outputTail = `${outputTail}${text}`.slice(-1024);
          const detection =
            tab.kind === "ssh" || tab.kind === "sftp"
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
          terminal.write(Uint8Array.from(message.data));
        }
        if (message.event === "exit") {
          readyRef.current = false;
          if (!legacyNegotiationFailed) setStatus("closed");
          terminal.writeln("\r\n\x1b[90m[Process exited]\x1b[0m");
        }
        if (message.event === "error") {
          setError(message.message);
          setStatus("error");
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
              : "create_serial_terminal";
      const createArguments = tab.kind === "local"
        ? { sessionId, cols: terminal.cols, rows: terminal.rows, workingDirectory: null, onEvent }
        : tab.kind === "serial"
          ? {
              sessionId,
              portName: connection?.serialPort,
              baudRate: connection?.baudRate,
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
              onEvent,
            };

      void invoke(createCommand, createArguments)
        .then(() => {
          if (disposed) {
            void invoke(tab.kind === "serial" ? "close_serial_terminal" : tab.kind === "telnet" ? "close_telnet_terminal" : "close_local_terminal", { sessionId });
            return;
          }
          readyRef.current = true;
          setStatus("active");
          terminal.focus();
        })
        .catch((reason) => {
          const message = String(reason);
          setError(message);
          setStatus("error");
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
        void invoke(tab.kind === "serial" ? "close_serial_terminal" : tab.kind === "telnet" ? "close_telnet_terminal" : "close_local_terminal", { sessionId });
    };
  }, [sessionId, tab.connection, tab.kind]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      fitRef.current?.fit();
      terminalRef.current?.focus();
    });
  }, [active]);

  const copySelection = async () => {
    const selection = terminalRef.current?.getSelection();
    if (selection) await navigator.clipboard.writeText(selection);
  };

  const pasteClipboard = async () => {
    const text = await navigator.clipboard.readText();
    if (readyRef.current)
      await invoke(tab.kind === "serial" ? "write_serial_terminal" : tab.kind === "telnet" ? "write_telnet_terminal" : "write_local_terminal", { sessionId, data: text });
  };

  return (
    <section
      className={`terminal-pane ${active ? "active" : ""}`}
      aria-hidden={!active}
    >
      <div className="terminal-toolbar">
        <div className={`terminal-connection-state ${status}`}>
          <span />
          {status}
        </div>
        <div>
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
        </div>
      </div>
      {error && (
        <div className="terminal-error" role="alert">
          <span>{error}</span>
        </div>
      )}
      <div className="xterm-host" ref={containerRef} />
    </section>
  );
}
