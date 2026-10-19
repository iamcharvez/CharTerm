import { Cable, Columns2, DatabaseZap, Grid2X2, LockKeyhole, Maximize2, Minus, Network, Plus, RadioTower, Rows2, Square, TerminalSquare, X } from "lucide-react";
import { useAppStore } from "../../stores/useAppStore";
import { SftpFileManager } from "./SftpFileManager";
import { TerminalPane } from "./TerminalPane";
import { getTerminalStageStyle } from "./terminalLayout";

export function LocalTerminalPage() {
  const tabs = useAppStore((state) => state.terminalTabs);
  const activeId = useAppStore((state) => state.activeTerminalId);
  const page = useAppStore((state) => state.page);
  const layout = useAppStore((state) => state.terminalLayout);
  const terminalPaneIds = useAppStore((state) => state.terminalPaneIds);
  const navigate = useAppStore((state) => state.navigate);
  const openLocalTerminal = useAppStore((state) => state.openLocalTerminal);
  const selectTerminal = useAppStore((state) => state.selectTerminal);
  const setTerminalLayout = useAppStore((state) => state.setTerminalLayout);
  const addTerminalPane = useAppStore((state) => state.addTerminalPane);
  const removeTerminalPane = useAppStore((state) => state.removeTerminalPane);
  const closeTerminal = useAppStore((state) => state.closeTerminal);
  const visibleIds = layout === "single"
    ? (activeId ? [activeId] : [])
    : terminalPaneIds;
  const paneCount = Math.max(1, visibleIds.length);
  const stageStyle = getTerminalStageStyle(layout, paneCount);
  const layoutKey = `${layout}:${visibleIds.join(",")}`;

  return (
    <main className="terminal-workspace">
      <div
        className="terminal-tabs"
        role="tablist"
        aria-label="Terminal sessions"
      >
        {tabs.map((tab) => (
          <button
            className={`terminal-tab ${activeId === tab.id ? "active" : ""}`}
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeId === tab.id}
            onClick={() => selectTerminal(tab.id)}
          >
            <TerminalSquare size={14} />
            <span>{tab.title}</span>
            <span
              className="terminal-tab-close"
              role="button"
              tabIndex={0}
              aria-label={`Close ${tab.title}`}
              onClick={(event) => {
                event.stopPropagation();
                closeTerminal(tab.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeTerminal(tab.id);
                }
              }}
            >
              <X size={13} />
            </span>
          </button>
        ))}
        <button
          className="new-tab-button"
          type="button"
          onClick={() => navigate("quick-connect")}
          aria-label="Open Quick Connect"
        >
          <Plus size={17} />
        </button>
        <div className="terminal-layout-toolbar" aria-label="Terminal layout">
          <button className={layout === "single" ? "active" : ""} type="button" onClick={() => setTerminalLayout("single")} title="Single terminal" aria-label="Single terminal"><Square size={15} /></button>
          <button className={layout === "columns" ? "active" : ""} type="button" onClick={() => setTerminalLayout("columns")} disabled={tabs.length < 2} title="Two terminals side by side" aria-label="Show two terminal columns"><Columns2 size={15} /></button>
          <button className={layout === "rows" ? "active" : ""} type="button" onClick={() => setTerminalLayout("rows")} disabled={tabs.length < 2} title="Two stacked terminals" aria-label="Show two terminal rows"><Rows2 size={15} /></button>
          <button className={layout === "grid" ? "active" : ""} type="button" onClick={() => setTerminalLayout("grid")} disabled={tabs.length < 2} title="Up to four terminals in a grid" aria-label="Show four-terminal grid"><Grid2X2 size={15} /></button>
          <button type="button" onClick={addTerminalPane} disabled={tabs.length < 2 || visibleIds.length >= Math.min(4, tabs.length)} title="Add session to split" aria-label="Add session to split"><Plus size={15} /></button>
        </div>
      </div>

      <div className={`terminal-stage terminal-layout-${layout}`} style={stageStyle}>
        {tabs.length === 0 ? (
          <div className="terminal-empty">
            <span><RadioTower size={32} /></span>
            <span className="terminal-empty-kicker">Connection workspace</span>
            <h1>Start a remote session</h1>
            <p>
              Choose the connection you need. Remote connections and local shells
              open here in their own tabs.
            </p>
            <div className="terminal-empty-protocols" aria-label="Supported connections">
              <span><LockKeyhole size={15} /> SSH</span>
              <span><DatabaseZap size={15} /> SFTP files</span>
              <span><Network size={15} /> Telnet</span>
              <span><Cable size={15} /> Serial</span>
              <span><RadioTower size={15} /> Other TCP</span>
              <span><TerminalSquare size={15} /> Local shell</span>
              <span><RadioTower size={15} /> X/Y/ZMODEM transfer</span>
            </div>
            <div className="terminal-empty-actions">
              <button
                className="primary-action"
                type="button"
                onClick={() => navigate("quick-connect")}
              >
                <Plus size={17} /> Open Quick Connect
              </button>
              <button
                className="secondary-action"
                type="button"
                onClick={openLocalTerminal}
              >
                <TerminalSquare size={17} /> New local terminal
              </button>
            </div>
          </div>
        ) : (
          tabs.map((tab) => {
            const visible = visibleIds.includes(tab.id);
            const focused = activeId === tab.id;
            const split = layout !== "single";
            return (
              <section
                className={`terminal-split-cell ${visible ? "visible" : ""} ${focused ? "focused" : ""} ${split ? "with-header" : ""}`}
                key={tab.id}
                aria-hidden={!visible || page !== "local-terminal"}
                onMouseDown={() => {
                  if (visible && !focused) selectTerminal(tab.id);
                }}
              >
                {split && visible && (
                  <header className="terminal-split-header">
                    <span><TerminalSquare size={13} /> {tab.title}</span>
                    <div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          selectTerminal(tab.id);
                          setTerminalLayout("single");
                        }}
                        title="Focus this session"
                        aria-label={`Maximize ${tab.title}`}
                      >
                        <Maximize2 size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeTerminalPane(tab.id);
                        }}
                        title="Remove from split (session stays open)"
                        aria-label={`Remove ${tab.title} from split`}
                      >
                        <Minus size={14} />
                      </button>
                    </div>
                  </header>
                )}
                {tab.kind === "sftp" ? (
                  <SftpFileManager tab={tab} active={visible} />
                ) : (
                  <TerminalPane
                    tab={tab}
                    active={visible}
                    pageActive={page === "local-terminal"}
                    layoutKey={layoutKey}
                  />
                )}
              </section>
            );
          })
        )}
      </div>

      <footer className="terminal-statusbar">
        <span>{layout === "single" ? "Connection workspace" : `${layout} split · ${visibleIds.length} panes`}</span>
        <span>UTF-8</span>
        <span>
          {tabs.length} session{tabs.length === 1 ? "" : "s"}
        </span>
      </footer>
    </main>
  );
}
