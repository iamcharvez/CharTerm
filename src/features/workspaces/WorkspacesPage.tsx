import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, Database, LoaderCircle, PanelsTopLeft, Play, Plus, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { createPersistentSnapshot, type PersistentAppState, useAppStore } from "../../stores/useAppStore";
import { recordActivity } from "../../lib/activityLog";

type WorkspaceRecord = {
  id: string;
  name: string;
  snapshotJson: string;
  createdAt: number;
  updatedAt: number;
};

const desktop = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function WorkspacesPage() {
  const hydrate = useAppStore((state) => state.hydrateApplicationState);
  const [items, setItems] = useState<WorkspaceRecord[]>([]);
  const [name, setName] = useState("");
  const [databasePath, setDatabasePath] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    if (!desktop()) return;
    const [records, path] = await Promise.all([
      invoke<WorkspaceRecord[]>("list_workspaces"),
      invoke<string>("get_database_path"),
    ]);
    setItems(records);
    setDatabasePath(path);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !desktop()) return;
    setBusy(true);
    const now = Date.now();
    try {
      await invoke("save_workspace", { workspace: {
        id: crypto.randomUUID(), name: name.trim().slice(0, 80),
        snapshotJson: JSON.stringify(createPersistentSnapshot(useAppStore.getState())),
        createdAt: now, updatedAt: now,
      }});
      setName("");
      setNotice("Workspace snapshot saved.");
      void recordActivity("info", "workspace", "Workspace snapshot saved", {
        sessions: useAppStore.getState().terminalTabs.length,
      });
      await refresh();
    } finally { setBusy(false); }
  };

  const restore = (workspace: WorkspaceRecord) => {
    try {
      hydrate(JSON.parse(workspace.snapshotJson) as PersistentAppState);
      useAppStore.getState().navigate("local-terminal");
      void recordActivity("info", "workspace", "Workspace snapshot restored");
    } catch { setNotice("This workspace snapshot could not be restored."); }
  };

  const remove = async (workspace: WorkspaceRecord) => {
    if (!window.confirm(`Delete workspace “${workspace.name}”?`)) return;
    await invoke("delete_workspace", { id: workspace.id });
    void recordActivity("info", "workspace", "Workspace snapshot deleted");
    await refresh();
  };

  return (
    <main className="workspace-page workspace-manager-page">
      <header className="workspace-header"><div><span>Recoverable layouts</span><h1>Workspaces</h1><p>Save your open sessions and split layout, then restore the same working context later without storing session passwords.</p></div></header>
      {notice && <div className="identity-notice success"><CheckCircle2 size={16} />{notice}</div>}
      <section className="workspace-save-card">
        <div><span><PanelsTopLeft size={24} /></span><div><h2>Save current workspace</h2><p>Profiles, open tabs, and pane layout are captured. Passwords and passphrases are always excluded.</p></div></div>
        <form onSubmit={saveWorkspace}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Night shift operations" maxLength={80} /><button className="primary-action" disabled={busy || !name.trim() || !desktop()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Save snapshot</button></form>
      </section>
      <section className="workspace-list-card">
        <div className="identity-section-heading"><div><span className="section-kicker">Saved locally</span><h2>{items.length} workspace{items.length === 1 ? "" : "s"}</h2></div></div>
        {items.length ? <div className="workspace-record-list">{items.map((item) => {
          const snapshot = JSON.parse(item.snapshotJson) as PersistentAppState;
          return <article key={item.id}><span><PanelsTopLeft size={20} /></span><div><strong>{item.name}</strong><small>{snapshot.terminalTabs?.length ?? 0} sessions · updated {new Date(item.updatedAt).toLocaleString()}</small></div><button onClick={() => restore(item)}><Play size={14} /> Restore</button><button className="danger" onClick={() => void remove(item)} title="Delete workspace"><Trash2 size={14} /></button></article>;
        })}</div> : <div className="workspace-empty"><PanelsTopLeft size={28} /><strong>No saved workspaces</strong><span>Save your current session layout above.</span></div>}
      </section>
      {databasePath && <div className="workspace-database-note"><Database size={15} /><span>Application data is stored in SQLite at</span><code>{databasePath}</code></div>}
    </main>
  );
}
