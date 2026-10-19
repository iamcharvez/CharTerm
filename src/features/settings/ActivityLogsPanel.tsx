import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Download,
  HardDrive,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogEntry = {
  id: number;
  createdAt: number;
  level: LogLevel;
  category: string;
  message: string;
  details?: string;
};
type LogPage = { entries: LogEntry[]; totalCount: number; approximateBytes: number };
type LogSettings = {
  retentionDays: number;
  maxEntries: number;
  maxSizeMb: number;
  minimumLevel: LogLevel | "off";
};
type BackgroundJob = {
  id: string;
  kind: string;
  label: string;
  state: string;
  progress?: number;
  error?: string;
  updatedAt: number;
};
type NativeConnection = {
  id: string;
  protocol: string;
  label: string;
  state: string;
  error?: string;
  updatedAt: number;
};

const defaults: LogSettings = {
  retentionDays: 14,
  maxEntries: 10_000,
  maxSizeMb: 10,
  minimumLevel: "info",
};

function desktop() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function levelIcon(level: LogLevel) {
  if (level === "error") return <AlertTriangle size={15} />;
  if (level === "warn") return <AlertTriangle size={15} />;
  if (level === "info") return <CheckCircle2 size={15} />;
  return <CircleDot size={15} />;
}

function parseDetails(details?: string) {
  if (!details) return undefined;
  try {
    return JSON.parse(details) as unknown;
  } catch {
    return details;
  }
}

export function ActivityLogsPanel() {
  const [page, setPage] = useState<LogPage>({ entries: [], totalCount: 0, approximateBytes: 0 });
  const [settings, setSettings] = useState<LogSettings>(defaults);
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [connections, setConnections] = useState<NativeConnection[]>([]);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const categories = useMemo(
    () => [...new Set(page.entries.map((entry) => entry.category))].sort(),
    [page.entries],
  );

  const refresh = useCallback(async () => {
    if (!desktop()) return;
    setBusy(true);
    try {
      const [result, runtimeJobs, runtimeConnections] = await Promise.all([
        invoke<LogPage>("list_activity_logs", {
          query: query || null,
          level: level || null,
          category: category || null,
          limit: 1_000,
        }),
        invoke<BackgroundJob[]>("list_background_jobs"),
        invoke<NativeConnection[]>("list_connection_runtime"),
      ]);
      setPage(result);
      setJobs(runtimeJobs);
      setConnections(runtimeConnections);
    } catch (reason) {
      setNotice(String(reason));
    } finally {
      setBusy(false);
    }
  }, [category, level, query]);

  useEffect(() => {
    if (!desktop()) return;
    void invoke<LogSettings>("get_activity_log_settings")
      .then(setSettings)
      .catch((reason) => setNotice(String(reason)));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 180);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const saveSettings = async () => {
    setBusy(true);
    try {
      const saved = await invoke<LogSettings>("update_activity_log_settings", { settings });
      setSettings(saved);
      setNotice("Log retention settings saved.");
      await refresh();
    } catch (reason) {
      setNotice(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const clearLogs = async () => {
    if (!window.confirm("Clear all CharTerm activity logs? This cannot be undone.")) return;
    await invoke("clear_activity_logs");
    setNotice("Activity logs cleared.");
    await refresh();
  };

  const exportLogs = () => {
    const lines = page.entries.map((entry) =>
      JSON.stringify({
        timestamp: new Date(entry.createdAt).toISOString(),
        level: entry.level,
        category: entry.category,
        message: entry.message,
        details: parseDetails(entry.details),
      }),
    );
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "application/x-ndjson" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `charterm-activity-${new Date().toISOString().slice(0, 10)}.ndjson`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <section className="log-overview">
        <div><CircleDot size={19} /><span><strong>{page.totalCount.toLocaleString()}</strong><small>retained events</small></span></div>
        <div><HardDrive size={19} /><span><strong>{formatBytes(page.approximateBytes)}</strong><small>estimated storage</small></span></div>
        <div><RefreshCw size={19} /><span><strong>{settings.retentionDays} days</strong><small>retention window</small></span></div>
      </section>

      <section className="settings-form-card log-retention-card">
        <header><div><strong>Retention limits</strong><span>CharTerm automatically removes the oldest events when any limit is reached.</span></div><button type="button" onClick={() => void saveSettings()} disabled={busy}><Save size={15} /> Save limits</button></header>
        <div className="log-setting-grid">
          <label><span>Keep for</span><div><input type="number" min={1} max={365} value={settings.retentionDays} onChange={(event) => setSettings((current) => ({ ...current, retentionDays: Number(event.target.value) }))} /><small>days</small></div></label>
          <label><span>Maximum events</span><input type="number" min={100} max={100000} step={100} value={settings.maxEntries} onChange={(event) => setSettings((current) => ({ ...current, maxEntries: Number(event.target.value) }))} /></label>
          <label><span>Storage limit</span><div><input type="number" min={1} max={500} value={settings.maxSizeMb} onChange={(event) => setSettings((current) => ({ ...current, maxSizeMb: Number(event.target.value) }))} /><small>MB</small></div></label>
          <label><span>Minimum level</span><select value={settings.minimumLevel} onChange={(event) => setSettings((current) => ({ ...current, minimumLevel: event.target.value as LogSettings["minimumLevel"] }))}><option value="debug">Debug</option><option value="info">Information</option><option value="warn">Warnings</option><option value="error">Errors only</option><option value="off">Logging off</option></select></label>
        </div>
        <p className="log-privacy-note">Terminal contents, typed commands, passwords, passphrases, tokens, and private-key material are never written to this activity log.</p>
      </section>

      <section className="settings-form-card activity-log-card">
        {(jobs.length > 0 || connections.length > 0) && <div className="background-job-strip"><header><div><strong>Native runtime</strong><span>{connections.filter((connection) => ["starting", "active"].includes(connection.state)).length} connections · {jobs.filter((job) => ["queued", "running", "cancelling"].includes(job.state)).length} jobs active</span></div>{jobs.length > 0 && <button type="button" onClick={async () => { await invoke("clear_finished_background_jobs"); await refresh(); }}>Clear finished</button>}</header>{connections.length > 0 && <div className="runtime-connections">{connections.slice(0, 8).map((connection) => <article key={connection.id}><span className={`job-state ${connection.state}`} /><div><strong>{connection.label}</strong><small>{connection.protocol} · {connection.state}</small></div><time>{new Date(connection.updatedAt).toLocaleTimeString()}</time></article>)}</div>}{jobs.length > 0 && <div>{jobs.slice(0, 8).map((job) => <article key={job.id}><span className={`job-state ${job.state}`} /> <div><strong>{job.label}</strong><small>{job.kind} · {job.state}</small>{typeof job.progress === "number" && <i><b style={{ width: `${job.progress * 100}%` }} /></i>}</div><time>{new Date(job.updatedAt).toLocaleTimeString()}</time></article>)}</div>}</div>}
        <header><div><strong>Activity history</strong><span>Connection, scan, transfer, workspace, and application lifecycle events.</span></div><div><button type="button" onClick={exportLogs} disabled={!page.entries.length}><Download size={14} /> Export</button><button className="danger" type="button" onClick={() => void clearLogs()} disabled={!page.totalCount}><Trash2 size={14} /> Clear</button></div></header>
        <div className="log-filters">
          <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search activity" /></label>
          <select value={level} onChange={(event) => setLevel(event.target.value)}><option value="">All levels</option><option value="debug">Debug</option><option value="info">Information</option><option value="warn">Warnings</option><option value="error">Errors</option></select>
          <select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select>
          <button type="button" onClick={() => void refresh()} disabled={busy}><RefreshCw className={busy ? "spin" : ""} size={14} /> Refresh</button>
        </div>
        {notice && <div className="log-notice"><CheckCircle2 size={14} /> <span>{notice}</span><button type="button" onClick={() => setNotice(null)}>Dismiss</button></div>}
        <div className="activity-log-list">
          {page.entries.map((entry) => <article className={`level-${entry.level}`} key={entry.id}><span>{levelIcon(entry.level)}</span><div><header><strong>{entry.message}</strong><time>{new Date(entry.createdAt).toLocaleString()}</time></header><p><b>{entry.category}</b><em>{entry.level}</em></p>{entry.details && <code>{entry.details}</code>}</div></article>)}
          {!page.entries.length && <div className="activity-log-empty"><CircleDot size={24} /><strong>No matching activity</strong><span>New lifecycle events will appear here.</span></div>}
        </div>
      </section>
    </>
  );
}
