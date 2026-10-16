import { Plus, TerminalSquare, X } from "lucide-react";
import { useAppStore } from "../../stores/useAppStore";
import { TerminalPane } from "./TerminalPane";

export function LocalTerminalPage() {
  const tabs = useAppStore((state) => state.terminalTabs);
  const activeId = useAppStore((state) => state.activeTerminalId);
  const openTerminal = useAppStore((state) => state.openLocalTerminal);
  const selectTerminal = useAppStore((state) => state.selectTerminal);
  const closeTerminal = useAppStore((state) => state.closeTerminal);

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
          onClick={openTerminal}
          aria-label="Open new local terminal"
        >
          <Plus size={17} />
        </button>
      </div>

      <div className="terminal-stage">
        {tabs.length === 0 ? (
          <div className="terminal-empty">
            <span>
              <TerminalSquare size={32} />
            </span>
            <h1>Local Terminal</h1>
            <p>
              Open a native shell session with full keyboard input, ANSI
              rendering, scrollback, and resize support.
            </p>
            <button
              className="primary-action"
              type="button"
              onClick={openTerminal}
            >
              <Plus size={17} /> New terminal
            </button>
          </div>
        ) : (
          tabs.map((tab) => (
            <TerminalPane
              key={tab.id}
              tab={tab}
              active={activeId === tab.id}
            />
          ))
        )}
      </div>

      <footer className="terminal-statusbar">
        <span>Native terminal workspace</span>
        <span>UTF-8</span>
        <span>
          {tabs.length} session{tabs.length === 1 ? "" : "s"}
        </span>
      </footer>
    </main>
  );
}
