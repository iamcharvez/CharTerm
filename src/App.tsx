import { lazy, Suspense, useEffect, useState } from "react";
import { AppSidebar } from "./components/AppSidebar";
import { CommandPalette } from "./components/CommandPalette";
import { ConnectionsPage } from "./features/connections/ConnectionsPage";
import { QuickConnectPage } from "./features/connections/QuickConnectPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { IdentitiesPage } from "./features/identities/IdentitiesPage";
import { SettingsWorkspace } from "./features/settings/SettingsWorkspace";
import { WorkspacesPage } from "./features/workspaces/WorkspacesPage";
import { loadPreferences } from "./lib/preferences";
import { initializeApplicationDatabase } from "./lib/applicationDatabase";
import { recordActivity } from "./lib/activityLog";
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("charterm-sidebar-collapsed") === "true",
  );
  const page = useAppStore((state) => state.page);
  const navigate = useAppStore((state) => state.navigate);
  const activeTerminalId = useAppStore((state) => state.activeTerminalId);
  const closeTerminal = useAppStore((state) => state.closeTerminal);
  const databaseReady = useAppStore((state) => state.databaseReady);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    void initializeApplicationDatabase()
      .then((cleanup) => {
        unsubscribe = cleanup;
        void recordActivity("info", "application", "Secure workspace opened");
      })
      .catch((error) => {
        console.error("Could not initialize CharTerm data", error);
        void recordActivity("error", "application", "Workspace database initialization failed");
        useAppStore.getState().hydrateApplicationState();
      });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("charterm-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("charterm-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [page]);

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
        navigate("quick-connect");
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
  }, [activeTerminalId, closeTerminal, navigate, page]);

  const toggleTheme = () =>
    setTheme((current) => (current === "dark" ? "light" : "dark"));

  if (!databaseReady) {
    return <div className="workspace-loader">Opening secure workspace…</div>;
  }

  return (
    <div className={`workspace-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <AppSidebar
        open={navigationOpen}
        collapsed={sidebarCollapsed}
        onOpenChange={setNavigationOpen}
        onCollapsedChange={setSidebarCollapsed}
      />
      <div className="workspace-main">
        {page === "dashboard" && <DashboardPage />}
        {page === "quick-connect" && <QuickConnectPage />}
        {page === "connections" && <ConnectionsPage mode="all" />}
        {page === "favorites" && <ConnectionsPage mode="favorites" />}
        {page === "recent" && <ConnectionsPage mode="recent" />}
        <div
          className={`persistent-tool-page ${page === "network-scanner" ? "visible" : ""}`}
          aria-hidden={page !== "network-scanner"}
        >
          <Suspense fallback={<div className="workspace-loader">Loading scanner…</div>}>
            <NetworkScannerPage />
          </Suspense>
        </div>
        {page === "ip-calculator" && (
          <Suspense fallback={<div className="workspace-loader">Loading calculator…</div>}>
            <IpCalculatorPage />
          </Suspense>
        )}
        {page === "identities" && <IdentitiesPage />}
        {page === "workspaces" && <WorkspacesPage />}
        <div
          className={`persistent-terminal-page ${page === "local-terminal" ? "visible" : ""}`}
          aria-hidden={page !== "local-terminal"}
        >
          <Suspense
            fallback={<div className="workspace-loader">Loading terminal…</div>}
          >
            <LocalTerminalPage />
          </Suspense>
        </div>
        {page === "settings" && (
          <SettingsWorkspace theme={theme} onThemeToggle={toggleTheme} />
        )}
      </div>
      <CommandPalette />
    </div>
  );
}
