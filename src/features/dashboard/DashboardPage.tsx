import {
  ArrowRight,
  Calculator,
  Network,
  Radar,
  ShieldCheck,
  TerminalSquare,
  Zap,
} from "lucide-react";
import { useAppStore } from "../../stores/useAppStore";

export function DashboardPage() {
  const openLocalTerminal = useAppStore((state) => state.openLocalTerminal);
  const navigate = useAppStore((state) => state.navigate);

  return (
    <main className="workspace-page dashboard-page">
      <header className="workspace-header">
        <div>
          <span>Welcome to CharTerm</span>
          <h1>Connection workspace</h1>
          <p>Connect to a server, network device, serial console, or local shell.</p>
        </div>
        <div className="local-ready-badge">
          <ShieldCheck size={16} /> Local-first workspace
        </div>
      </header>

      <section className="dashboard-hero">
        <div>
          <span className="section-kicker">Every connection, one workspace</span>
          <h2>Connect without typing commands.</h2>
          <p>
            Use a friendly form for SSH, SFTP, Telnet, and Serial, then work
            inside CharTerm's tabbed terminal.
          </p>
          <button
            className="primary-action"
            type="button"
            onClick={() => navigate("quick-connect")}
          >
            <Zap size={18} /> New connection{" "}
            <ArrowRight size={16} />
          </button>
        </div>
        <div className="dashboard-terminal-preview" aria-hidden="true">
          <span>charterm › ssh › server.example.com</span>
          <strong>_</strong>
        </div>
      </section>

      <section className="dashboard-actions" aria-label="Connection actions">
        <button type="button" onClick={() => navigate("local-terminal")}>
          <span className="dashboard-action-icon ready">
            <TerminalSquare size={21} />
          </span>
          <div>
            <strong>Local Terminal</strong>
            <span>Interactive PTY sessions</span>
          </div>
          <span className="feature-ready">Built in</span>
        </button>
        <button type="button" onClick={() => navigate("quick-connect")}>
          <span className="dashboard-action-icon">
            <Zap size={21} />
          </span>
          <div>
            <strong>Quick Connect</strong>
            <span>SSH, SFTP, Telnet, and Serial</span>
          </div>
          <span className="feature-ready">Ready</span>
        </button>
        <button type="button" onClick={() => navigate("connections")}>
          <span className="dashboard-action-icon">
            <Network size={21} />
          </span>
          <div>
            <strong>Saved Connections</strong>
            <span>Reusable remote profiles</span>
          </div>
          <span className="feature-ready">Ready</span>
        </button>
        <button type="button" onClick={() => navigate("network-scanner")}>
          <span className="dashboard-action-icon">
            <Radar size={21} />
          </span>
          <div>
            <strong>Network Scanner</strong>
            <span>Discover devices and open ports</span>
          </div>
          <span className="feature-ready">Ready</span>
        </button>
        <button type="button" onClick={() => navigate("ip-calculator")}>
          <span className="dashboard-action-icon">
            <Calculator size={21} />
          </span>
          <div>
            <strong>IP Calculator</strong>
            <span>IPv4 and IPv6 subnet planning</span>
          </div>
          <span className="feature-ready">Ready</span>
        </button>
      </section>
    </main>
  );
}
