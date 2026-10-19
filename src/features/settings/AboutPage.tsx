import {
  Apple,
  Box,
  Check,
  ChevronRight,
  Code2,
  Command,
  Feather,
  Download,
  Globe2,
  Laptop,
  Menu,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Wifi,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { CharTermLogo } from "../../components/CharTermLogo";
import { ThemeToggle } from "../../components/ThemeToggle";
import { useAppMetadata } from "../../hooks/useAppMetadata";

const platforms = [
  { name: "Windows", detail: "Windows 10 & 11", icon: Laptop },
  { name: "Linux", detail: "Major distributions", icon: TerminalSquare },
  { name: "macOS", detail: "Intel & Apple silicon", icon: Apple },
];

const principles = [
  { name: "Fast", icon: Zap },
  { name: "Secure", icon: ShieldCheck },
  { name: "Reliable", icon: Wifi },
  { name: "Simple", icon: Sparkles },
];

type AboutPageProps = {
  theme: "dark" | "light";
  onThemeToggle: () => void;
  onMenuOpen: () => void;
};

export function AboutPage({ theme, onThemeToggle, onMenuOpen }: AboutPageProps) {
  const metadata = useAppMetadata();
  const currentYear = new Date().getFullYear();

  return (
    <main className="about-page">
      <header className="page-topbar">
        <div className="breadcrumb">
          <button className="icon-button mobile-menu" type="button" onClick={onMenuOpen} aria-label="Open settings navigation">
            <Menu size={20} />
          </button>
          <span>Settings</span>
          <ChevronRight size={14} />
          <strong>About</strong>
        </div>
        <ThemeToggle theme={theme} onToggle={onThemeToggle} />
      </header>

      <div className="about-content">
        <section className="hero-card" aria-labelledby="about-title">
          <div className="hero-grid" aria-hidden="true" />
          <div className="hero-glow hero-glow-one" aria-hidden="true" />
          <div className="hero-glow hero-glow-two" aria-hidden="true" />

          <div className="hero-copy">
            <div className="hero-eyebrow"><Sparkles size={14} /> Every connection. One workspace.</div>
            <div className="hero-title-row">
              <div className="hero-logo"><CharTermLogo size={76} /></div>
              <div>
                <h1 id="about-title">{metadata.name}</h1>
                <p className="meaning">Charvez Terminal</p>
              </div>
            </div>
            <p className="tagline">One Terminal. <span>Every Connection.</span></p>
            <p className="hero-description">
              A modern, lightweight terminal and remote connection manager that brings every shell, server, and device into one focused workspace.
            </p>
            <div className="hero-meta">
              <span className="version-pill"><span className="pulse-dot" /> Version {metadata.version}</span>
              <span className="platform-pill"><Globe2 size={15} /> Cross-platform</span>
              <UpdateControl />
            </div>
          </div>

          <div className="terminal-art" aria-hidden="true">
            <div className="terminal-art-bar">
              <div><i /><i /><i /></div>
              <span>charterm — about</span>
              <Command size={13} />
            </div>
            <div className="terminal-art-body">
              <p><span className="prompt">➜</span> <span className="directory">~</span> charterm --info</p>
              <p><span className="muted">Application</span> <b>CharTerm</b></p>
              <p><span className="muted">Purpose</span> <b>Connect everything.</b></p>
              <p><span className="muted">Status</span> <span className="success"><Check size={13} /> Ready</span></p>
              <p><span className="prompt">➜</span> <span className="terminal-cursor" /></p>
            </div>
          </div>
        </section>

        <section className="content-grid" aria-label="About CharTerm details">
          <article className="info-card story-card">
            <div className="card-heading">
              <span className="card-icon cyan"><Feather size={19} /></span>
              <div><p>Our story</p><h2>About CharTerm</h2></div>
            </div>
            <div className="story-copy">
              <p>
                CharTerm is a modern, lightweight, and powerful terminal and remote connection manager developed by <strong>Charlie M. Chavez</strong>.
              </p>
              <p>
                Designed for developers, network engineers, system administrators, and IT professionals, CharTerm provides a unified workspace for SSH, SFTP, Telnet, Serial, and local terminal connections.
              </p>
              <p>
                <strong>My mission</strong> is to simplify remote system administration by delivering a fast, secure, reliable, and intuitive desktop experience.
              </p>
            </div>
            <div className="promise"><ShieldCheck size={18} /><span>Private by Design. Reliable by Default.</span></div>
          </article>

          <div className="side-stack">
            <article className="info-card developer-card">
              <div className="developer-avatar" aria-hidden="true">CC</div>
              <div className="developer-copy">
                <span>Creator &amp; developer</span>
                <h2>Charlie M. Chavez</h2>
                <p>Designing tools that make complex systems feel simple.</p>
              </div>
              <div className="code-mark"><Code2 size={20} /></div>
            </article>

            <article className="info-card app-type-card">
              <div className="card-heading compact">
                <span className="card-icon blue"><Box size={18} /></span>
                <div><p>Application type</p><h2>Terminal &amp; Remote Connection Manager</h2></div>
              </div>
            </article>
          </div>
        </section>

        <section className="details-grid">
          <article className="info-card">
            <div className="section-heading">
              <div><span>Runs where you do</span><h2>Supported platforms</h2></div>
              <Globe2 size={20} />
            </div>
            <div className="platform-list">
              {platforms.map(({ name, detail, icon: Icon }) => (
                <div className="platform-item" key={name}>
                  <span className="platform-icon"><Icon size={21} /></span>
                  <div><strong>{name}</strong><span>{detail}</span></div>
                  <Check className="platform-check" size={16} />
                </div>
              ))}
            </div>
          </article>

          <article className="info-card">
            <div className="section-heading">
              <div><span>What guides us</span><h2>Product principles</h2></div>
              <Sparkles size={20} />
            </div>
            <div className="principles-grid">
              {principles.map(({ name, icon: Icon }) => (
                <div className="principle-item" key={name}>
                  <Icon size={20} />
                  <strong>{name}</strong>
                </div>
              ))}
            </div>
            <p className="principles-note">A focused experience for managing systems with confidence.</p>
          </article>
        </section>

        <section className="license-card" aria-labelledby="license-title">
          <div className="license-mark"><ShieldCheck size={23} /></div>
          <div className="license-copy">
            <span>Software license</span>
            <h2 id="license-title">Proprietary — Free to Use</h2>
            <p>Free for personal, educational, professional, and internal business use under the CharTerm Software License Agreement.</p>
          </div>
          <div className="license-meta">
            <strong>All rights reserved</strong>
            <span>© {currentYear} Charlie M. Chavez</span>
          </div>
        </section>

        <footer className="about-footer">
          <div><CharTermLogo size={24} /><span>© {currentYear} CharTerm — Developed by Charlie M. Chavez</span></div>
          <p>One Terminal. Every Connection.</p>
        </footer>
      </div>
    </main>
  );
}

function UpdateControl() {
  const desktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const [state, setState] = useState<"idle" | "checking" | "current" | "available" | "downloading" | "ready" | "error">("idle");
  const [message, setMessage] = useState("");
  if (!desktop) return null;

  const checkForUpdates = async () => {
    setState("checking");
    setMessage("");
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        setState("current");
        setMessage("You have the latest version.");
        return;
      }
      setState("available");
      setMessage(`Version ${update.version} is available.`);
      setState("downloading");
      await update.downloadAndInstall((event) => {
        if (event.event === "Finished") setState("ready");
      });
      setState("ready");
      setMessage(`Version ${update.version} is installed and ready to restart.`);
    } catch (reason) {
      setState("error");
      setMessage(String(reason));
    }
  };

  const restart = async () => {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  };

  return (
    <div className="update-control">
      {state === "ready" ? (
        <button type="button" onClick={() => void restart()}><Download size={14} /> Restart to update</button>
      ) : (
        <button type="button" disabled={state === "checking" || state === "downloading"} onClick={() => void checkForUpdates()}>
          <Download size={14} /> {state === "checking" ? "Checking…" : state === "downloading" ? "Installing…" : "Check for updates"}
        </button>
      )}
      {message && <span className={state === "error" ? "error" : ""}>{message}</span>}
    </div>
  );
}

