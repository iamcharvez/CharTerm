import {
  Accessibility,
  AppWindow,
  Bell,
  ChevronLeft,
  CircleUserRound,
  Info,
  Keyboard,
  LockKeyhole,
  MonitorCog,
  Network,
  Palette,
  Settings2,
} from "lucide-react";
import { CharTermLogo } from "./CharTermLogo";

const groups = [
  {
    label: "Preferences",
    items: [
      { id: "general", label: "General", icon: Settings2 },
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "terminal", label: "Terminal", icon: MonitorCog },
      { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
    ],
  },
  {
    label: "Application",
    items: [
      { id: "connections", label: "Connections", icon: Network },
      { id: "security", label: "Security", icon: LockKeyhole },
      { id: "notifications", label: "Notifications", icon: Bell },
      { id: "accessibility", label: "Accessibility", icon: Accessibility },
      { id: "about", label: "About", icon: Info },
    ],
  },
] as const;

export type SettingsPageId = (typeof groups)[number]["items"][number]["id"];

type SettingsSidebarProps = {
  activePage: SettingsPageId;
  onNavigate: (page: SettingsPageId) => void;
  onClose?: () => void;
};

export function SettingsSidebar({
  activePage,
  onNavigate,
  onClose,
}: SettingsSidebarProps) {
  return (
    <aside className="settings-sidebar" aria-label="Settings navigation">
      <div className="sidebar-brand">
        <CharTermLogo size={34} />
        <span>CharTerm</span>
        {onClose && (
          <button
            className="icon-button sidebar-close"
            onClick={onClose}
            aria-label="Close settings navigation"
          >
            <ChevronLeft size={19} />
          </button>
        )}
      </div>

      <div className="settings-heading">
        <span className="settings-symbol">
          <AppWindow size={17} />
        </span>
        <div>
          <strong>Settings</strong>
          <span>Configure your workspace</span>
        </div>
      </div>

      <nav className="settings-nav">
        {groups.map((group) => (
          <div className="nav-group" key={group.label}>
            <p>{group.label}</p>
            {group.items.map(({ id, label, icon: Icon }) => {
              const isActive = activePage === id;
              return (
                <button
                  className={`nav-item ${isActive ? "active" : ""}`}
                  key={id}
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => {
                    onNavigate(id);
                    onClose?.();
                  }}
                >
                  <Icon size={18} strokeWidth={1.8} />
                  <span>{label}</span>
                  {isActive && <span className="active-dot" />}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-profile">
        <div className="profile-avatar">
          <CircleUserRound size={19} />
        </div>
        <div>
          <strong>Local workspace</strong>
          <span>Offline ready</span>
        </div>
        <span className="online-dot" aria-label="Available" />
      </div>
    </aside>
  );
}
