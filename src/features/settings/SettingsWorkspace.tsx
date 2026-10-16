import { useState } from "react";
import {
  SettingsSidebar,
  type SettingsPageId,
} from "../../components/SettingsSidebar";
import { AboutPage } from "./AboutPage";
import { SettingsPanel } from "./SettingsPanel";

type SettingsWorkspaceProps = {
  theme: "dark" | "light";
  onThemeToggle: () => void;
};

export function SettingsWorkspace({
  theme,
  onThemeToggle,
}: SettingsWorkspaceProps) {
  const [activePage, setActivePage] = useState<SettingsPageId>("general");
  const [navigationOpen, setNavigationOpen] = useState(false);

  return (
    <div className="settings-workspace">
      <div className={`settings-sidebar-layer ${navigationOpen ? "open" : ""}`}>
        <SettingsSidebar
          activePage={activePage}
          onNavigate={setActivePage}
          onClose={() => setNavigationOpen(false)}
        />
      </div>
      {navigationOpen && (
        <button
          className="settings-sidebar-scrim"
          type="button"
          aria-label="Close settings navigation"
          onClick={() => setNavigationOpen(false)}
        />
      )}
      {activePage === "about" ? (
        <AboutPage
          theme={theme}
          onThemeToggle={onThemeToggle}
          onMenuOpen={() => setNavigationOpen(true)}
        />
      ) : (
        <SettingsPanel
          page={activePage}
          theme={theme}
          onThemeToggle={onThemeToggle}
          onMenuOpen={() => setNavigationOpen(true)}
        />
      )}
    </div>
  );
}
