import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronRight, Menu, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ThemeToggle } from "../../components/ThemeToggle";
import type { SettingsPageId } from "../../components/SettingsSidebar";
import { ActivityLogsPanel } from "./ActivityLogsPanel";
import {
  loadPreferences,
  savePreferences,
  type CharTermPreferences,
} from "../../lib/preferences";

const labels: Record<Exclude<SettingsPageId, "about">, string> = {
  general: "General",
  appearance: "Appearance",
  terminal: "Terminal",
  shortcuts: "Shortcuts",
  connections: "Connections",
  security: "Security",
  notifications: "Notifications",
  accessibility: "Accessibility",
  logs: "Activity Logs",
};

type SettingsPanelProps = {
  page: Exclude<SettingsPageId, "about">;
  theme: "dark" | "light";
  onThemeToggle: () => void;
  onMenuOpen: () => void;
};

export function SettingsPanel({
  page,
  theme,
  onThemeToggle,
  onMenuOpen,
}: SettingsPanelProps) {
  const [preferences, setPreferences] = useState(loadPreferences);

  const update = <Key extends keyof CharTermPreferences>(
    key: Key,
    value: CharTermPreferences[Key],
  ) => {
    setPreferences((current) => {
      const next = { ...current, [key]: value };
      savePreferences(next);
      return next;
    });
  };

  return (
    <main className="about-page settings-panel-page">
      <header className="page-topbar">
        <div className="breadcrumb">
          <button
            className="icon-button mobile-menu"
            type="button"
            onClick={onMenuOpen}
            aria-label="Open settings navigation"
          >
            <Menu size={20} />
          </button>
          <span>Settings</span>
          <ChevronRight size={14} />
          <strong>{labels[page]}</strong>
        </div>
        <ThemeToggle theme={theme} onToggle={onThemeToggle} />
      </header>

      <div className="settings-form-content">
        <header>
          <span>CharTerm preferences</span>
          <h1>{labels[page]}</h1>
          <p>Changes are saved immediately on this device.</p>
        </header>

        {page === "general" && (
          <section className="settings-form-card">
            <ToggleRow
              label="Confirm before closing active sessions"
              description="Prevent accidental termination of running terminals."
              checked={preferences.confirmBeforeClosing}
              onChange={(value) => update("confirmBeforeClosing", value)}
            />
            <ToggleRow
              label="Restore previous sessions"
              description="Remember open connection tabs for the next launch."
              checked={preferences.restoreSessions}
              onChange={(value) => update("restoreSessions", value)}
            />
          </section>
        )}

        {page === "appearance" && (
          <section className="settings-form-card">
            <div className="settings-row">
              <div>
                <strong>Application theme</strong>
                <span>Choose the interface appearance.</span>
              </div>
              <div className="theme-choice">
                <button
                  type="button"
                  className={theme === "dark" ? "selected" : ""}
                  onClick={() => theme === "light" && onThemeToggle()}
                >
                  Dark
                </button>
                <button
                  type="button"
                  className={theme === "light" ? "selected" : ""}
                  onClick={() => theme === "dark" && onThemeToggle()}
                >
                  Light
                </button>
              </div>
            </div>
          </section>
        )}

        {page === "terminal" && (
          <section className="settings-form-card">
            <NumberRow
              label="Font size"
              description="Applied to newly opened terminal sessions."
              value={preferences.fontSize}
              min={10}
              max={28}
              onChange={(value) => update("fontSize", value)}
            />
            <NumberRow
              label="Scrollback lines"
              description="Maximum terminal history retained per session."
              value={preferences.scrollback}
              min={1000}
              max={100000}
              step={1000}
              onChange={(value) => update("scrollback", value)}
            />
            <div className="settings-row">
              <div>
                <strong>Cursor style</strong>
                <span>Applied to newly opened terminal sessions.</span>
              </div>
              <select
                value={preferences.cursorStyle}
                onChange={(event) =>
                  update(
                    "cursorStyle",
                    event.target.value as CharTermPreferences["cursorStyle"],
                  )
                }
              >
                <option value="bar">Bar</option>
                <option value="block">Block</option>
                <option value="underline">Underline</option>
              </select>
            </div>
          </section>
        )}

        {page === "shortcuts" && (
          <section className="settings-form-card shortcut-list">
            <ShortcutRow label="New connection" keys="Ctrl + Shift + T" />
            <ShortcutRow
              label="Close active terminal"
              keys="Ctrl + Shift + W"
            />
            <ShortcutRow label="Copy selection" keys="Ctrl + Shift + C" />
            <ShortcutRow label="Paste" keys="Ctrl + Shift + V" />
          </section>
        )}

        {page === "connections" && (
          <section className="settings-form-card">
            <NumberRow
              label="Connection timeout"
              description="Seconds before a remote connection attempt fails."
              value={preferences.connectionTimeout}
              min={3}
              max={120}
              onChange={(value) => update("connectionTimeout", value)}
            />
            <NumberRow
              label="Keepalive interval"
              description="Seconds between keepalive messages for supported protocols."
              value={preferences.keepaliveSeconds}
              min={5}
              max={300}
              step={5}
              onChange={(value) => update("keepaliveSeconds", value)}
            />
            <div className="settings-info">
              <ShieldCheck size={17} />
              <span>
                Applied to new SSH, SFTP, Telnet, and custom TCP connection attempts.
              </span>
            </div>
          </section>
        )}

        {page === "security" && (
          <><section className="settings-form-card">
            <div className="settings-row locked">
              <div>
                <strong>SSH host-key verification</strong>
                <span>Required and cannot be disabled silently.</span>
              </div>
              <span className="required-badge">
                <Check size={14} /> Required
              </span>
            </div>
            <div className="settings-row locked">
              <div>
                <strong>Plaintext password storage</strong>
                <span>
                  Optional saved passwords use the operating system credential
                  vault and never ordinary application settings.
                </span>
              </div>
              <span className="disabled-badge">Disabled</span>
            </div>
          </section><KnownHosts /></>
        )}

        {page === "notifications" && (
          <section className="settings-form-card">
            <ToggleRow
              label="Application notifications"
              description="Allow session and transfer completion alerts when implemented."
              checked={preferences.notifications}
              onChange={(value) => update("notifications", value)}
            />
          </section>
        )}

        {page === "accessibility" && (
          <section className="settings-form-card">
            <ToggleRow
              label="Reduce motion"
              description="Minimize interface transitions and animated terminal decoration."
              checked={preferences.reducedMotion}
              onChange={(value) => update("reducedMotion", value)}
            />
          </section>
        )}

        {page === "logs" && <ActivityLogsPanel />}
      </div>
    </main>
  );
}

type KnownHost = { host: string; port: number; keyType: string; fingerprint: string; firstSeenAt: number; lastSeenAt: number };

function KnownHosts() {
  const [hosts, setHosts] = useState<KnownHost[]>([]);
  const desktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const refresh = () => desktop && void invoke<KnownHost[]>("list_known_hosts").then(setHosts).catch(() => setHosts([]));
  useEffect(() => { refresh(); }, [desktop]);
  const forget = async (host: KnownHost) => {
    if (!window.confirm(`Forget the trusted key for ${host.host}:${host.port}? You will be asked to verify it again.`)) return;
    await invoke("forget_known_host", { host: host.host, port: host.port, keyType: host.keyType });
    refresh();
  };
  return <section className="settings-form-card known-hosts-card"><div className="known-hosts-heading"><div><strong>Trusted server identities</strong><span>Review fingerprints accepted for SFTP connections.</span></div><b>{hosts.length}</b></div>{hosts.length ? hosts.map((host) => <div className="known-host-row" key={`${host.host}:${host.port}:${host.keyType}`}><ShieldCheck size={17} /><div><strong>{host.host}:{host.port}</strong><span>{host.keyType}</span><code>{host.fingerprint}</code></div><button type="button" onClick={() => void forget(host)} title="Forget host key"><Trash2 size={15} /></button></div>) : <div className="settings-info"><ShieldCheck size={17} /><span>No server keys have been trusted yet.</span></div>}</section>;
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="settings-row">
      <div>
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function NumberRow({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="settings-row">
      <div>
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ShortcutRow({ label, keys }: { label: string; keys: string }) {
  return (
    <div className="settings-row">
      <div>
        <strong>{label}</strong>
      </div>
      <kbd>{keys}</kbd>
    </div>
  );
}
