import { Calculator, KeyRound, Network, PanelsTopLeft, Radar, Search, Settings, TerminalSquare, X, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppStore, type AppPage } from "../stores/useAppStore";

const destinations: Array<{ page: AppPage; label: string; detail: string; icon: typeof Search }> = [
  { page: "quick-connect", label: "New connection", detail: "SSH, SFTP, Telnet, Serial, TCP, or Local", icon: Zap },
  { page: "connections", label: "Saved connections", detail: "Search and organize profiles", icon: Network },
  { page: "local-terminal", label: "Terminal sessions", detail: "Tabs and split panes", icon: TerminalSquare },
  { page: "workspaces", label: "Workspaces", detail: "Save or recover a layout", icon: PanelsTopLeft },
  { page: "network-scanner", label: "Network scanner", detail: "Discover hosts and ports", icon: Radar },
  { page: "ip-calculator", label: "IP calculator", detail: "IPv4 and IPv6 subnet tools", icon: Calculator },
  { page: "identities", label: "SSH identities", detail: "Keys and certificates", icon: KeyRound },
  { page: "settings", label: "Settings", detail: "Preferences, security, and updates", icon: Settings },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useAppStore((state) => state.navigate);
  const editConnection = useAppStore((state) => state.editConnection);
  const profiles = useAppStore((state) => state.profiles);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const needle = query.trim().toLowerCase();
  const filteredDestinations = destinations.filter((item) => !needle || `${item.label} ${item.detail}`.toLowerCase().includes(needle));
  const filteredProfiles = useMemo(() => profiles.filter((profile) => !needle || `${profile.name} ${profile.host ?? ""} ${profile.username ?? ""} ${profile.protocol}`.toLowerCase().includes(needle)).slice(0, 8), [needle, profiles]);
  if (!open) return null;

  const close = () => { setOpen(false); setQuery(""); };
  return <div className="command-palette-layer" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(event) => event.target === event.currentTarget && close()}><section className="command-palette"><header><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tools and saved connections…" /><kbd>Esc</kbd><button onClick={close} aria-label="Close"><X size={16} /></button></header><div className="command-results">{filteredProfiles.length > 0 && <div className="command-group"><span>Connections</span>{filteredProfiles.map((profile) => <button key={profile.id} onClick={() => { editConnection(profile.id); close(); }}><Network size={17} /><div><strong>{profile.name}</strong><small>{profile.protocol.toUpperCase()} · {profile.host ?? profile.serialPort}</small></div><em>Edit</em></button>)}</div>}<div className="command-group"><span>Navigate</span>{filteredDestinations.map(({ page, label, detail, icon: Icon }) => <button key={page} onClick={() => { navigate(page); close(); }}><Icon size={17} /><div><strong>{label}</strong><small>{detail}</small></div></button>)}</div>{!filteredProfiles.length && !filteredDestinations.length && <div className="command-empty">No matching tools or connections.</div>}</div><footer><span><kbd>Ctrl</kbd><kbd>K</kbd> open anywhere</span><span>Private local search</span></footer></section></div>;
}
