import { Channel, invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  File,
  Folder,
  FolderPlus,
  KeyRound,
  LoaderCircle,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { PasswordInput } from "../../components/PasswordInput";
import { loadPreferences } from "../../lib/preferences";
import { recordActivity } from "../../lib/activityLog";
import { removeNativeConnection, updateNativeConnection, updateNativeJob } from "../../lib/nativeCore";
import { useAppStore, type TerminalTab } from "../../stores/useAppStore";

type FileEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified?: number;
};

type DirectoryListing = {
  path: string;
  parentPath?: string;
  entries: FileEntry[];
};

type ConnectionInfo = { remoteHome: string; fingerprint: string };
type ConnectionStatus = "connecting" | "credentials" | "trust" | "active" | "error";
type SftpFileManagerProps = { tab: TerminalTab; active: boolean };
type TransferJob = { id: string; name: string; direction: "upload" | "download"; status: "running" | "complete" | "error" | "cancelled"; transferred: number; total: number; startedAt: number; updatedAt: number; error?: string };
type TransferEvent = { jobId: string; bytesTransferred: number; bytesTotal: number; status: TransferJob["status"] };

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function localJoin(directory: string, name: string) {
  const separator = directory.includes("\\") ? "\\" : "/";
  return `${directory.replace(/[\\/]$/, "")}${separator}${name}`;
}

function remoteJoin(directory: string, name: string) {
  return directory === "/" ? `/${name}` : `${directory.replace(/\/$/, "")}/${name}`;
}

function formatSize(size: number, directory: boolean) {
  if (directory) return "Folder";
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(1)} GB`;
}

function formatModified(value?: number) {
  return value ? new Date(value * 1000).toLocaleString() : "—";
}

function transferRate(job: TransferJob) {
  const seconds = Math.max(0.25, (job.updatedAt - job.startedAt) / 1000);
  return job.transferred ? `${formatSize(job.transferred / seconds, false)}/s` : "Preparing";
}

function transferEta(job: TransferJob) {
  if (!job.total || !job.transferred || job.status !== "running") return "";
  const elapsed = Math.max(0.25, (job.updatedAt - job.startedAt) / 1000);
  const remaining = (job.total - job.transferred) / (job.transferred / elapsed);
  if (!Number.isFinite(remaining) || remaining <= 0) return "";
  if (remaining < 60) return `${Math.ceil(remaining)}s left`;
  return `${Math.ceil(remaining / 60)}m left`;
}

export function SftpFileManager({ tab, active }: SftpFileManagerProps) {
  const connection = tab.connection;
  const identity = useAppStore((state) => state.identities.find((item) => item.id === connection?.identityId));
  const [status, setStatus] = useState<ConnectionStatus>(
    connection?.username ? "connecting" : "credentials",
  );
  const [username, setUsername] = useState(connection?.username ?? "");
  const [password, setPassword] = useState(tab.sessionPassword ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [hostKeyChanged, setHostKeyChanged] = useState(false);
  const [hostKeyType, setHostKeyType] = useState("");
  const [hostPublicKey, setHostPublicKey] = useState("");
  const [attempt, setAttempt] = useState(connection?.username ? 1 : 0);
  const [local, setLocal] = useState<DirectoryListing | null>(null);
  const [remote, setRemote] = useState<DirectoryListing | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [localSelection, setLocalSelection] = useState<FileEntry | null>(null);
  const [remoteSelection, setRemoteSelection] = useState<FileEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<TransferJob[]>([]);

  const loadLocal = useCallback(async (path?: string) => {
    const listing = await invoke<DirectoryListing>("list_local_directory", {
      path: path || null,
    });
    setLocal(listing);
    setLocalPath(listing.path);
    setLocalSelection(null);
  }, []);

  const loadRemote = useCallback(
    async (path: string) => {
      const listing = await invoke<DirectoryListing>("list_remote_directory", {
        sessionId: tab.id,
        path,
      });
      setRemote(listing);
      setRemotePath(listing.path);
      setRemoteSelection(null);
    },
    [tab.id],
  );

  useEffect(() => {
    if (!attempt || !connection?.host || !connection.port || !username.trim()) return;
    if (!isTauriRuntime()) {
      setStatus("error");
      setError("SFTP requires the CharTerm desktop application.");
      return;
    }
    let cancelled = false;
    setStatus("connecting");
    setError(null);
    void updateNativeConnection(tab.id, "sftp", "SFTP session", "starting");
    const preferences = loadPreferences();
    void invoke<ConnectionInfo>("connect_sftp", {
      sessionId: tab.id,
      host: connection.host,
      port: connection.port,
      username: username.trim(),
      password: password || null,
      credentialId: connection.hasSavedPassword ? connection.id : null,
      authenticationMode: connection.authenticationMode ?? "auto",
      privateKeyPath: identity?.privateKeyPath ?? null,
      keyPassphrase: tab.sessionKeyPassphrase ?? null,
      identityId: identity?.hasSavedPassphrase ? identity.id : null,
      connectionTimeout: preferences.connectionTimeout,
    })
      .then(async (info) => {
        if (cancelled) return;
        setPassword("");
        setFingerprint(info.fingerprint);
        setStatus("active");
        void recordActivity("info", "connection", "SFTP session connected", {
          protocol: "sftp",
        });
        void updateNativeConnection(tab.id, "sftp", "SFTP session", "active");
        await Promise.all([loadLocal(), loadRemote(info.remoteHome)]);
      })
      .catch((reason) => {
        if (cancelled) return;
        const message = String(reason);
        if (message.includes("HOST_KEY_REQUIRED|") || message.includes("HOST_KEY_CHANGED|")) {
          const changed = message.includes("HOST_KEY_CHANGED|");
          const payload = message.split(changed ? "HOST_KEY_CHANGED|" : "HOST_KEY_REQUIRED|")[1] ?? "";
          const parts = payload.split("|");
          setFingerprint(changed ? parts[1] : parts[0]);
          setHostKeyType(changed ? parts[2] : parts[1]);
          setHostPublicKey(changed ? parts[3] : parts[2]);
          setHostKeyChanged(changed);
          setStatus("trust");
          return;
        }
        if (message.includes("AUTH_REQUIRED|")) {
          setError(message.split("AUTH_REQUIRED|")[1]?.trim() || "Authentication failed.");
          setStatus("credentials");
          return;
        }
        setError(message);
        setStatus("error");
        void recordActivity("error", "connection", "SFTP session failed", {
          protocol: "sftp",
        });
        void updateNativeConnection(tab.id, "sftp", "SFTP session", "error", message);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, loadLocal, loadRemote, tab.id, identity, tab.sessionKeyPassphrase]);

  useEffect(
    () => () => {
      if (isTauriRuntime()) void invoke("close_sftp", { sessionId: tab.id });
      void removeNativeConnection(tab.id);
    },
    [tab.id],
  );

  const submitCredentials = (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim()) {
      setError("Enter your SFTP username.");
      return;
    }
    setAttempt((value) => value + 1);
  };

  const trustServer = async () => {
    if (!fingerprint || !connection?.host || !hostKeyType || !hostPublicKey) return;
    const now = Date.now();
    setStatus("connecting");
    setError(null);
    try {
      await invoke("trust_known_host", {
        host: {
          host: connection.host,
          port: connection.port ?? 22,
          keyType: hostKeyType,
          fingerprint,
          publicKey: hostPublicKey,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });
      setAttempt((value) => value + 1);
    } catch (reason) {
      setError(String(reason));
      setStatus("trust");
    }
  };

  const runAction = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  };

  const runTransfer = async (name: string, direction: "upload" | "download", action: (id: string, progress: Channel<TransferEvent>) => Promise<void>) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const job: TransferJob = { id, name, direction, status: "running", transferred: 0, total: 0, startedAt: now, updatedAt: now };
    const progress = new Channel<TransferEvent>();
    progress.onmessage = (event) => setTransfers((current) => current.map((item) => item.id === id ? {
      ...item,
      transferred: event.bytesTransferred,
      total: event.bytesTotal,
      status: event.status,
      updatedAt: Date.now(),
    } : item));
    setTransfers((current) => [job, ...current].slice(0, 6));
    void updateNativeJob(id, "sftp-transfer", `SFTP ${direction}`, "running", 0);
    void recordActivity("info", "transfer", `SFTP ${direction} started`, { direction });
    setBusy(direction === "upload" ? "Uploading" : "Downloading");
    setError(null);
    try {
      await action(id, progress);
      setTransfers((current) => current.map((job) => job.id === id ? { ...job, status: "complete", updatedAt: Date.now() } : job));
      void updateNativeJob(id, "sftp-transfer", `SFTP ${direction}`, "complete", 1);
      void recordActivity("info", "transfer", `SFTP ${direction} completed`, { direction });
    } catch (reason) {
      const message = String(reason);
      setError(message);
      setTransfers((current) => current.map((job) => job.id === id ? { ...job, status: message.includes("cancelled") ? "cancelled" : "error", error: message, updatedAt: Date.now() } : job));
      void updateNativeJob(id, "sftp-transfer", `SFTP ${direction}`, message.includes("cancelled") ? "cancelled" : "error", undefined, message);
      void recordActivity(message.includes("cancelled") ? "warn" : "error", "transfer", `SFTP ${direction} ${message.includes("cancelled") ? "cancelled" : "failed"}`, { direction });
    } finally {
      setBusy(null);
    }
  };

  const upload = () => {
    if (!localSelection || !remote) return;
    const destination = remoteJoin(remote.path, localSelection.name);
    if (remote.entries.some((entry) => entry.name === localSelection.name) &&
        !window.confirm(localSelection.isDirectory
          ? `${localSelection.name} already exists remotely. Merge the folder and replace matching files?`
          : `${localSelection.name} already exists remotely. Replace it?`)) return;
    void runTransfer(localSelection.name, "upload", async (jobId, onProgress) => {
      await invoke(localSelection.isDirectory ? "sftp_upload_directory" : "sftp_upload", {
        sessionId: tab.id,
        localPath: localSelection.path,
        remotePath: destination,
        jobId,
        onProgress,
      });
      await loadRemote(remote.path);
    });
  };

  const download = () => {
    if (!remoteSelection || !local) return;
    const destination = localJoin(local.path, remoteSelection.name);
    if (local.entries.some((entry) => entry.name === remoteSelection.name) &&
        !window.confirm(`${remoteSelection.name} already exists locally. Merge or replace its contents?`)) return;
    void runTransfer(remoteSelection.name, "download", async (jobId, onProgress) => {
      await invoke(remoteSelection.isDirectory ? "sftp_download_directory" : "sftp_download", {
        sessionId: tab.id,
        remotePath: remoteSelection.path,
        localPath: destination,
        jobId,
        onProgress,
      });
      await loadLocal(local.path);
    });
  };

  const createRemoteFolder = () => {
    if (!remote) return;
    const name = window.prompt("New remote folder name:")?.trim();
    if (!name || name.includes("/")) return;
    void runAction("Creating folder", async () => {
      await invoke("sftp_create_directory", {
        sessionId: tab.id,
        path: remoteJoin(remote.path, name),
      });
      await loadRemote(remote.path);
    });
  };

  const renameRemote = () => {
    if (!remote || !remoteSelection) return;
    const name = window.prompt("Rename remote item:", remoteSelection.name)?.trim();
    if (!name || name === remoteSelection.name || name.includes("/")) return;
    void runAction("Renaming", async () => {
      await invoke("sftp_rename", {
        sessionId: tab.id,
        fromPath: remoteSelection.path,
        toPath: remoteJoin(remote.path, name),
      });
      await loadRemote(remote.path);
    });
  };

  const deleteRemote = () => {
    if (!remote || !remoteSelection) return;
    if (!window.confirm(`Delete ${remoteSelection.name} from the server? This cannot be undone.`)) return;
    void runAction("Deleting", async () => {
      await invoke("sftp_delete", {
        sessionId: tab.id,
        path: remoteSelection.path,
        isDirectory: remoteSelection.isDirectory,
      });
      await loadRemote(remote.path);
    });
  };

  if (status !== "active") {
    return (
      <section className={`sftp-pane sftp-connect-mode ${active ? "active" : ""}`} aria-hidden={!active}>
        <div className="sftp-connect-card">
          {status === "connecting" ? (
            <>
              <span className="sftp-connect-icon"><LoaderCircle className="spin" size={28} /></span>
              <h1>Connecting securely</h1>
              <p>Opening the SFTP file channel to {connection?.host}:{connection?.port}…</p>
            </>
          ) : status === "trust" ? (
            <>
              <span className={`sftp-connect-icon ${hostKeyChanged ? "danger" : "warning"}`}><ShieldCheck size={28} /></span>
              <span className="section-kicker">{hostKeyChanged ? "Security warning" : "First connection"}</span>
              <h1>{hostKeyChanged ? "Server identity changed" : "Verify this server"}</h1>
              <p>{hostKeyChanged
                ? "This fingerprint does not match the one previously trusted. Verify the change with the server administrator before continuing."
                : "Confirm this SHA-256 host-key fingerprint with the server administrator before trusting it."}</p>
              <code className="sftp-fingerprint">{fingerprint}</code>
              <div className="sftp-connect-actions">
                <button type="button" className="secondary-action" onClick={() => setStatus("error")}>Cancel</button>
                <button type="button" className="primary-action" onClick={trustServer}><ShieldCheck size={16} /> {hostKeyChanged ? "Replace trust and connect" : "Trust and connect"}</button>
              </div>
            </>
          ) : (
            <form onSubmit={submitCredentials}>
              <span className="sftp-connect-icon"><KeyRound size={28} /></span>
              <span className="section-kicker">Secure file transfer</span>
              <h1>{status === "error" ? "Connection needs attention" : "Sign in to SFTP"}</h1>
              <p>{connection?.host}:{connection?.port} · Credentials remain in this session unless saved in the system vault.</p>
              {error && <div className="sftp-auth-error"><AlertTriangle size={16} /> {error}</div>}
              <label className="field">
                <span>Username</span>
                <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus />
              </label>
              <label className="field">
                <span>Password <small>optional when SSH agent authentication is available</small></span>
                <PasswordInput value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
              </label>
              <button type="submit" className="primary-action"><KeyRound size={16} /> Connect to files</button>
            </form>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className={`sftp-pane ${active ? "active" : ""}`} aria-hidden={!active}>
      <header className="sftp-toolbar">
        <div><CheckCircle2 size={14} /> Secure SFTP · {username}@{connection?.host}</div>
        <div>{busy ? <><LoaderCircle className="spin" size={14} /> {busy}…</> : "Ready"}</div>
      </header>
      {error && <div className="terminal-error"><span>{error}</span><button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
      <div className="sftp-browser">
        <FilePane
          side="local"
          title="This computer"
          listing={local}
          path={localPath}
          selected={localSelection}
          disabled={Boolean(busy)}
          onPathChange={setLocalPath}
          onOpen={(entry) => entry.isDirectory ? void runAction("Opening folder", () => loadLocal(entry.path)) : setLocalSelection(entry)}
          onSelect={setLocalSelection}
          onGo={() => void runAction("Opening folder", () => loadLocal(localPath))}
          onUp={() => {
            const parent = local?.parentPath;
            if (parent) void runAction("Opening folder", () => loadLocal(parent));
          }}
          onRefresh={() => local && void runAction("Refreshing", () => loadLocal(local.path))}
        />

        <div className="sftp-transfer-rail">
          <button type="button" onClick={upload} disabled={!localSelection || Boolean(busy)} title="Upload selected file or folder">
            <ArrowUpFromLine size={18} /><span>{localSelection?.isDirectory ? "Upload folder" : "Upload"}</span>
          </button>
          <button type="button" onClick={download} disabled={!remoteSelection || Boolean(busy)} title="Download selected file or folder">
            <ArrowDownToLine size={18} /><span>{remoteSelection?.isDirectory ? "Download folder" : "Download"}</span>
          </button>
        </div>

        <FilePane
          side="remote"
          title="Remote server"
          listing={remote}
          path={remotePath}
          selected={remoteSelection}
          disabled={Boolean(busy)}
          onPathChange={setRemotePath}
          onOpen={(entry) => entry.isDirectory ? void runAction("Opening folder", () => loadRemote(entry.path)) : setRemoteSelection(entry)}
          onSelect={setRemoteSelection}
          onGo={() => void runAction("Opening folder", () => loadRemote(remotePath))}
          onUp={() => {
            const parent = remote?.parentPath;
            if (parent) void runAction("Opening folder", () => loadRemote(parent));
          }}
          onRefresh={() => remote && void runAction("Refreshing", () => loadRemote(remote.path))}
          actions={
            <>
              <button type="button" onClick={createRemoteFolder} disabled={Boolean(busy)} title="New remote folder"><FolderPlus size={14} /> New folder</button>
              <button type="button" onClick={renameRemote} disabled={!remoteSelection || Boolean(busy)} title="Rename"><Pencil size={14} /> Rename</button>
              <button type="button" className="danger" onClick={deleteRemote} disabled={!remoteSelection || Boolean(busy)} title="Delete"><Trash2 size={14} /> Delete</button>
            </>
          }
        />
      </div>
      {transfers.length > 0 && (
        <aside className="sftp-transfer-queue" aria-label="Recent file transfers">
          <header><div><strong>Transfers</strong><span>{transfers.filter((job) => job.status === "running").length ? "Working" : "Complete"}</span></div><button type="button" onClick={() => setTransfers([])} title="Clear transfer history"><X size={14} /></button></header>
          <div>{transfers.map((job) => (
            <article className={job.status} key={job.id} title={job.error}>
              <span>{job.status === "running" ? <LoaderCircle className="spin" size={15} /> : job.status === "complete" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}</span>
              <div><strong>{job.name}</strong><small>{job.total ? `${Math.round(job.transferred / job.total * 100)}% · ${formatSize(job.transferred, false)} / ${formatSize(job.total, false)} · ${transferRate(job)}${transferEta(job) ? ` · ${transferEta(job)}` : ""}` : job.direction === "upload" ? "Preparing upload" : "Preparing download"}</small><i style={{ width: `${job.total ? Math.min(100, job.transferred / job.total * 100) : 4}%` }} /></div>
              {job.status === "running" ? <button type="button" onClick={() => void invoke("cancel_sftp_transfer", { jobId: job.id })}>Cancel</button> : <em>{job.status}</em>}
            </article>
          ))}</div>
        </aside>
      )}
    </section>
  );
}

type FilePaneProps = {
  side: "local" | "remote";
  title: string;
  listing: DirectoryListing | null;
  path: string;
  selected: FileEntry | null;
  disabled: boolean;
  actions?: ReactNode;
  onPathChange: (value: string) => void;
  onSelect: (entry: FileEntry) => void;
  onOpen: (entry: FileEntry) => void;
  onGo: () => void;
  onUp: () => void;
  onRefresh: () => void;
};

function FilePane({ side, title, listing, path, selected, disabled, actions, onPathChange, onSelect, onOpen, onGo, onUp, onRefresh }: FilePaneProps) {
  return (
    <article className="sftp-file-pane">
      <header>
        <div><span className={side}>{side === "local" ? "LOCAL" : "SFTP"}</span><strong>{title}</strong></div>
        <div className="sftp-pane-actions">{actions}</div>
      </header>
      <form className="sftp-pathbar" onSubmit={(event) => { event.preventDefault(); onGo(); }}>
        <button className="sftp-back-button" type="button" onClick={onUp} disabled={!listing?.parentPath || disabled} title="Back to parent folder"><ArrowLeft size={14} /><span>Back</span></button>
        <input value={path} onChange={(event) => onPathChange(event.target.value)} aria-label={`${title} path`} />
        <button type="button" onClick={onRefresh} disabled={!listing || disabled} title="Refresh"><RefreshCw size={14} /></button>
      </form>
      <div className="sftp-file-table">
        <div className="sftp-file-head"><span>Name</span><span>Size</span><span>Modified</span></div>
        <div className="sftp-file-list">
          {!listing ? (
            <div className="sftp-loading"><LoaderCircle className="spin" size={20} /> Loading files…</div>
          ) : <>
          {listing.parentPath && (
            <button
              type="button"
              className="sftp-parent-entry"
              onClick={onUp}
              disabled={disabled}
              title="Open parent directory"
            >
              <span className="sftp-file-name"><Folder size={15} /><span>..</span><em>Parent directory</em></span>
              <span>Folder</span>
              <span>—</span>
            </button>
          )}
          {listing.entries.length === 0 ? (
            <div className="sftp-loading"><Folder size={20} /> This folder is empty</div>
          ) : listing.entries.map((entry) => (
            <button
              type="button"
              className={selected?.path === entry.path ? "selected" : ""}
              key={entry.path}
              onClick={() => onSelect(entry)}
              onDoubleClick={() => onOpen(entry)}
              disabled={disabled}
            >
              <span className="sftp-file-name">{entry.isDirectory ? <Folder size={15} /> : <File size={15} />}<span>{entry.name}</span></span>
              <span>{formatSize(entry.size, entry.isDirectory)}</span>
              <span>{formatModified(entry.modified)}</span>
            </button>
          ))}
          </>}
        </div>
      </div>
    </article>
  );
}
