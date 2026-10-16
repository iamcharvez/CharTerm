import { lazy, Suspense, useEffect, useState } from "react";
import { AppSidebar } from "./components/AppSidebar";
import { ConnectionsPage } from "./features/connections/ConnectionsPage";
import { QuickConnectPage } from "./features/connections/QuickConnectPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { SettingsWorkspace } from "./features/settings/SettingsWorkspace";
import { loadPreferences } from "./lib/preferences";
import { useAppStore } from "./stores/useAppStore";

const LocalTerminalPage = lazy(async () => {
  const module = await import("./features/terminal/LocalTerminalPage");
  return { default: module.LocalTerminalPage };
});
const NetworkScannerPage = lazy(async () => {
  const module = await import("./features/scanner/NetworkScannerPage");
  return { default: module.NetworkScannerPage };
});
const IpCalculatorPage = lazy(async () => {
  const module = await import("./features/calculator/IpCalculatorPage");
  return { default: module.IpCalculatorPage };
});

type Theme = "dark" | "light";

function getInitialTheme(): Theme {
  const stored = localStorage.getItem("charterm-theme");
  return stored === "light" || stored === "dark" ? stored : "dark";
}

export function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const page = useAppStore((state) => state.page);
  const openLocalTerminal = useAppStore((state) => state.openLocalTerminal);
  const activeTerminalId = useAppStore((state) => state.activeTerminalId);
  const closeTerminal = useAppStore((state) => state.closeTerminal);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("charterm-theme", theme);
  }, [theme]);

  useEffect(() => {
    const applyAccessibility = () => {
      document.documentElement.dataset.reduceMotion = String(
        loadPreferences().reducedMotion,
      );
    };
    applyAccessibility();
    window.addEventListener("charterm-preferences", applyAccessibility);
    return () =>
      window.removeEventListener("charterm-preferences", applyAccessibility);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey) return;
      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        openLocalTerminal();
      }
      if (
        event.key.toLowerCase() === "w" &&
        page === "local-terminal" &&
        activeTerminalId
      ) {
        event.preventDefault();
        closeTerminal(activeTerminalId);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [activeTerminalId, closeTerminal, openLocalTerminal, page]);

  const toggleTheme = () =>
    setTheme((current) => (current === "dark" ? "light" : "dark"));

  return (
    <div className="workspace-shell">
      <AppSidebar open={navigationOpen} onOpenChange={setNavigationOpen} />
      <div className="workspace-main">
        {page === "dashboard" && <DashboardPage />}
        {page === "quick-connect" && <QuickConnectPage />}
        {page === "connections" && <ConnectionsPage mode="all" />}
        {page === "favorites" && <ConnectionsPage mode="favorites" />}
        {page === "recent" && <ConnectionsPage mode="recent" />}
        {page === "network-scanner" && (
          <Suspense fallback={<div className="workspace-loader">Loading scanner…</div>}>
            <NetworkScannerPage />
          </Suspense>
        )}
        {page === "ip-calculator" && (
          <Suspense fallback={<div className="workspace-loader">Loading calculator…</div>}>
            <IpCalculatorPage />
          </Suspense>
        )}
        {page === "local-terminal" && (
          <Suspense
            fallback={<div className="workspace-loader">Loading terminal…</div>}
          >
            <LocalTerminalPage />
          </Suspense>
        )}
        {page === "settings" && (
          <SettingsWorkspace theme={theme} onThemeToggle={toggleTheme} />
        )}
      </div>
    </div>
  );
}
