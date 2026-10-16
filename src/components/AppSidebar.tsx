import {
  Calculator,
  Clock3,
  FolderHeart,
  Gauge,
  Menu,
  Network,
  Plus,
  Radar,
  Settings,
  TerminalSquare,
  X,
  Zap,
} from "lucide-react";
import { useAppStore, type AppPage } from "../stores/useAppStore";
import { CharTermLogo } from "./CharTermLogo";

const items: Array<{
  id: AppPage;
  label: string;
  icon: typeof Gauge;
}> = [
  { id: "dashboard", label: "Dashboard", icon: Gauge },
  { id: "quick-connect", label: "Quick Connect", icon: Zap },
  { id: "connections", label: "Saved Connections", icon: Network },
  { id: "favorites", label: "Favorites", icon: FolderHeart },
  { id: "recent", label: "Recent Sessions", icon: Clock3 },
  { id: "network-scanner", label: "Network Scanner", icon: Radar },
  { id: "ip-calculator", label: "IP Calculator", icon: Calculator },
  {
    id: "local-terminal",
    label: "Terminal Sessions",
    icon: TerminalSquare,
  },
  { id: "settings", label: "Settings", icon: Settings },
];

type AppSidebarProps = { open: boolean; onOpenChange: (open: boolean) => void };

export function AppSidebar({ open, onOpenChange }: AppSidebarProps) {
  const page = useAppStore((state) => state.page);
  const navigate = useAppStore((state) => state.navigate);

  return (
    <>
      <aside
        className={`app-sidebar ${open ? "open" : ""}`}
        aria-label="Main navigation"
      >
        <div className="app-brand">
          <CharTermLogo size={36} />
          <div>
            <strong>CharTerm</strong>
            <span>Connection workspace</span>
          </div>
          <button
            className="icon-button app-sidebar-close"
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <button
          className="new-session-button"
          type="button"
          onClick={() => {
            navigate("quick-connect");
            onOpenChange(false);
          }}
        >
          <Plus size={17} /> New connection
        </button>

        <nav className="app-nav">
          {items.map(({ id, label, icon: Icon }) => (
            <button
              className={`app-nav-item ${page === id ? "active" : ""}`}
              type="button"
              key={id}
              aria-current={page === id ? "page" : undefined}
              onClick={() => {
                navigate(id);
                onOpenChange(false);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="app-sidebar-footer">
          <span className="online-dot" />
          <span>Local mode</span>
        </div>
      </aside>
      {open && (
        <button
          className="app-sidebar-scrim"
          type="button"
          aria-label="Close navigation"
          onClick={() => onOpenChange(false)}
        />
      )}
      <button
        className="floating-menu-button"
        type="button"
        aria-label="Open navigation"
        onClick={() => onOpenChange(true)}
      >
        <Menu size={19} />
      </button>
    </>
  );
}
