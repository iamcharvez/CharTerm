import { invoke } from "@tauri-apps/api/core";
import {
  Cable,
  DatabaseZap,
  Folder,
  LockKeyhole,
  Network,
  Save,
  TerminalSquare,
  Wifi,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { flattenConnectionGroups } from "../../lib/connectionGroups";
import {
  useAppStore,
  type ConnectionDraft,
  type ConnectionProfile,
  type ConnectionProtocol,
} from "../../stores/useAppStore";

type SerialPort = { name: string; kind: string };

const protocols: Array<{
  id: ConnectionProtocol;
  label: string;
  description: string;
  icon: typeof Wifi;
}> = [
  { id: "ssh", label: "SSH", description: "Secure shell", icon: LockKeyhole },
  { id: "sftp", label: "SFTP", description: "Secure files", icon: DatabaseZap },
  { id: "telnet", label: "Telnet", description: "Legacy devices", icon: Network },
  { id: "serial", label: "Serial", description: "COM / TTY", icon: Cable },
];

const defaultPorts: Record<Exclude<ConnectionProtocol, "serial">, number> = {
  ssh: 22,
  sftp: 22,
  telnet: 23,
};

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function QuickConnectPage() {
  const openConnection = useAppStore((state) => state.openConnection);
  const saveProfile = useAppStore((state) => state.saveProfile);
  const openLocalTerminal = useAppStore((state) => state.openLocalTerminal);
  const groups = useAppStore((state) => state.groups);
  const [protocol, setProtocol] = useState<ConnectionProtocol>("ssh");
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [savePassword, setSavePassword] = useState(false);
  const [serialPort, setSerialPort] = useState("");
  const [baudRate, setBaudRate] = useState(115200);
  const [shouldSave, setShouldSave] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [serialPorts, setSerialPorts] = useState<SerialPort[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke<SerialPort[]>("list_serial_ports")
      .then((ports) => {
        setSerialPorts(ports);
        if (ports[0]) setSerialPort((current) => current || ports[0].name);
      })
      .catch(() => setSerialPorts([]));
  }, []);

  const selectedProtocol = useMemo(
    () => protocols.find((item) => item.id === protocol)!,
    [protocol],
  );
  const flatGroups = useMemo(() => flattenConnectionGroups(groups), [groups]);

  const chooseProtocol = (next: ConnectionProtocol) => {
    setProtocol(next);
    setError(null);
    if (next !== "serial") setPort(defaultPorts[next]);
  };

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (protocol === "serial" && !serialPort.trim()) {
      setError("Choose or enter a serial port, such as COM3 or /dev/ttyUSB0.");
      return;
    }
    if (protocol !== "serial" && !host.trim()) {
      setError("Enter a host name or IP address.");
      return;
    }
    const draft: ConnectionDraft =
      protocol === "serial"
        ? {
            name: name.trim() || `${serialPort} serial`,
            protocol,
            serialPort: serialPort.trim(),
            baudRate,
            groupId: shouldSave && groupId ? groupId : undefined,
          }
        : {
            name: name.trim() || host.trim(),
            protocol,
            host: host.trim(),
            port,
            username:
              protocol === "ssh" || protocol === "sftp"
                ? username.trim()
                : undefined,
            groupId: shouldSave && groupId ? groupId : undefined,
            hasSavedPassword:
              (protocol === "ssh" || protocol === "sftp") &&
              shouldSave &&
              savePassword &&
              password.length > 0,
          };

    const id = crypto.randomUUID();
    if (draft.hasSavedPassword) {
      try {
        await invoke("save_connection_password", {
          profileId: id,
          password,
        });
      } catch (reason) {
        setError(String(reason));
        return;
      }
    }
    if (shouldSave) saveProfile(draft, id);
    const connection: ConnectionProfile = {
      ...draft,
      id,
      favorite: false,
      createdAt: Date.now(),
    };
    openConnection(connection, draft.hasSavedPassword ? undefined : password);
  };

  return (
    <main className="workspace-page connection-page">
      <header className="workspace-header">
        <div>
          <span>New connection</span>
          <h1>Quick Connect</h1>
          <p>Pick a protocol, enter the device details, and connect in one click.</p>
        </div>
        <button className="secondary-action" type="button" onClick={openLocalTerminal}>
          <TerminalSquare size={17} /> Local terminal
        </button>
      </header>

      <form className="connection-form-card" onSubmit={connect}>
        <section>
          <div className="form-section-heading">
            <div>
              <span className="section-kicker">Connection type</span>
              <h2>How do you want to connect?</h2>
            </div>
          </div>
          <div className="protocol-grid">
            {protocols.map(({ id, label, description, icon: Icon }) => (
              <button
                className={`protocol-choice ${protocol === id ? "active" : ""}`}
                type="button"
                key={id}
                onClick={() => chooseProtocol(id)}
                aria-pressed={protocol === id}
              >
                <Icon size={20} />
                <span><strong>{label}</strong><small>{description}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="connection-fields">
          <div className="form-section-heading compact">
            <div>
              <span className="section-kicker">{selectedProtocol.label} details</span>
              <h2>{protocol === "serial" ? "Choose your device" : "Where should CharTerm connect?"}</h2>
            </div>
          </div>

          <div className="form-grid">
            <label className="field field-wide">
              <span>Connection name <small>optional</small></span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Production server" />
            </label>

            {protocol === "serial" ? (
              <>
                <label className="field">
                  <span>Serial port</span>
                  <input
                    list="serial-port-options"
                    value={serialPort}
                    onChange={(event) => setSerialPort(event.target.value)}
                    placeholder="COM3 or /dev/ttyUSB0"
                    autoFocus
                  />
                  <datalist id="serial-port-options">
                    {serialPorts.map((item) => <option key={item.name} value={item.name}>{item.kind}</option>)}
                  </datalist>
                </label>
                <label className="field">
                  <span>Baud rate</span>
                  <select value={baudRate} onChange={(event) => setBaudRate(Number(event.target.value))}>
                    {[9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map((rate) => <option key={rate} value={rate}>{rate.toLocaleString()}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label className="field field-host">
                  <span>Host or IP address</span>
                  <input value={host} onChange={(event) => setHost(event.target.value)} placeholder="server.example.com" autoFocus />
                </label>
                <label className="field field-port">
                  <span>Port</span>
                  <input type="number" min={1} max={65535} value={port} onChange={(event) => setPort(Number(event.target.value))} />
                </label>
                {(protocol === "ssh" || protocol === "sftp") && (
                  <>
                  <label className="field field-wide">
                    <span>Username <small>optional</small></span>
                    <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Leave blank to get a ‘login as’ prompt" autoComplete="username" />
                  </label>
                  <label className="field field-wide">
                    <span>Password <small>optional — key authentication is supported</small></span>
                    <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Leave blank to enter it in the terminal" autoComplete="current-password" />
                  </label>
                  </>
                )}
              </>
            )}
          </div>
        </section>

        <div className="security-note">
          <LockKeyhole size={17} />
          <span>
            {protocol === "telnet"
              ? "Telnet is unencrypted. Use it only on trusted networks and legacy devices."
              : protocol === "serial"
                ? "CharTerm talks directly to the selected local serial port."
                : "Passwords and key passphrases are entered inside the terminal and are never saved in the profile."}
          </span>
        </div>

        {error && <div className="form-error" role="alert">{error}</div>}

        <div className="connection-form-footer">
          <label className="save-profile-check">
            <input type="checkbox" checked={shouldSave} onChange={(event) => setShouldSave(event.target.checked)} />
            <Save size={16} /> Save this profile
          </label>
          {shouldSave && (
            <label className="save-group-field">
              <Folder size={16} />
              <span>Group</span>
              <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                <option value="">Ungrouped</option>
                {flatGroups.map((group) => (
                  <option value={group.id} key={group.id}>
                    {`${"— ".repeat(group.depth)}${group.name}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(protocol === "ssh" || protocol === "sftp") && (
            <label className="save-profile-check secure-password-check">
              <input
                type="checkbox"
                checked={savePassword}
                disabled={!shouldSave || password.length === 0}
                onChange={(event) => setSavePassword(event.target.checked)}
              />
              <LockKeyhole size={16} /> Save password in system vault
            </label>
          )}
          <button className="primary-action" type="submit">
            <Wifi size={17} /> Connect with {selectedProtocol.label}
          </button>
        </div>
      </form>
    </main>
  );
}
