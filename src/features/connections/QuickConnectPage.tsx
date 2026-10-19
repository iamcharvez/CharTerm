import { invoke } from "@tauri-apps/api/core";
import {
  Cable,
  ChevronDown,
  DatabaseZap,
  Folder,
  CheckCircle2,
  LockKeyhole,
  Network,
  PlugZap,
  Save,
  RefreshCw,
  TerminalSquare,
  Wifi,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { PasswordInput } from "../../components/PasswordInput";
import { flattenConnectionGroups } from "../../lib/connectionGroups";
import {
  useAppStore,
  type ConnectionDraft,
  type ConnectionProfile,
  type ConnectionProtocol,
  type AuthenticationMode,
  type SerialEncoding,
  type SerialFlowControl,
  type SerialParity,
} from "../../stores/useAppStore";

type SerialPort = {
  name: string;
  kind: string;
  product?: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: number;
  productId?: number;
};
type QuickConnectProtocol = ConnectionProtocol | "local";

const protocols: Array<{
  id: QuickConnectProtocol;
  label: string;
  description: string;
  icon: typeof Wifi;
}> = [
  { id: "ssh", label: "SSH", description: "Secure shell", icon: LockKeyhole },
  { id: "sftp", label: "SFTP", description: "Secure files", icon: DatabaseZap },
  { id: "telnet", label: "Telnet", description: "Legacy devices", icon: Network },
  { id: "serial", label: "Serial", description: "COM / TTY", icon: Cable },
  { id: "tcp", label: "Other", description: "Any TCP port", icon: PlugZap },
  { id: "local", label: "Local", description: "Native shell", icon: TerminalSquare },
];

const defaultPorts: Record<Exclude<ConnectionProtocol, "serial">, number> = {
  ssh: 22,
  sftp: 22,
  telnet: 23,
  tcp: 8080,
};

const commonBaudRates = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200,
  230400, 460800, 921600,
];

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function QuickConnectPage() {
  const openConnection = useAppStore((state) => state.openConnection);
  const openLocalTerminal = useAppStore((state) => state.openLocalTerminal);
  const saveProfile = useAppStore((state) => state.saveProfile);
  const groups = useAppStore((state) => state.groups);
  const profiles = useAppStore((state) => state.profiles);
  const identities = useAppStore((state) => state.identities);
  const editingProfileId = useAppStore((state) => state.editingProfileId);
  const navigate = useAppStore((state) => state.navigate);
  const editingProfile = profiles.find((profile) => profile.id === editingProfileId);
  const isEditing = Boolean(editingProfile);
  const [protocol, setProtocol] = useState<QuickConnectProtocol>(editingProfile?.protocol ?? "ssh");
  const [name, setName] = useState(editingProfile?.name ?? "");
  const [host, setHost] = useState(editingProfile?.host ?? "");
  const [port, setPort] = useState(editingProfile?.port ?? 22);
  const [username, setUsername] = useState(editingProfile?.username ?? "");
  const [password, setPassword] = useState("");
  const [keyPassphrase, setKeyPassphrase] = useState("");
  const [authenticationMode, setAuthenticationMode] = useState<AuthenticationMode>(editingProfile?.authenticationMode ?? "password");
  const [showAdvancedAuth, setShowAdvancedAuth] = useState(
    Boolean(editingProfile && (editingProfile.authenticationMode ?? "password") !== "password"),
  );
  const [identityId, setIdentityId] = useState(editingProfile?.identityId ?? "");
  const [savePassword, setSavePassword] = useState(Boolean(editingProfile?.hasSavedPassword));
  const [serialPort, setSerialPort] = useState(editingProfile?.serialPort ?? "");
  const [baudRate, setBaudRate] = useState(String(editingProfile?.baudRate ?? 115200));
  const [showAdvancedSerial, setShowAdvancedSerial] = useState(Boolean(
    editingProfile && (
      (editingProfile.serialDataBits ?? 8) !== 8 ||
      (editingProfile.serialStopBits ?? 1) !== 1 ||
      (editingProfile.serialParity ?? "none") !== "none" ||
      (editingProfile.serialFlowControl ?? "none") !== "none" ||
      (editingProfile.serialEncoding ?? "utf-8") !== "utf-8"
    ),
  ));
  const [serialDataBits, setSerialDataBits] = useState<5 | 6 | 7 | 8>(editingProfile?.serialDataBits ?? 8);
  const [serialStopBits, setSerialStopBits] = useState<1 | 2>(editingProfile?.serialStopBits ?? 1);
  const [serialParity, setSerialParity] = useState<SerialParity>(editingProfile?.serialParity ?? "none");
  const [serialFlowControl, setSerialFlowControl] = useState<SerialFlowControl>(editingProfile?.serialFlowControl ?? "none");
  const [serialEncoding, setSerialEncoding] = useState<SerialEncoding>(editingProfile?.serialEncoding ?? "utf-8");
  const [shouldSave, setShouldSave] = useState(isEditing);
  const [groupId, setGroupId] = useState(editingProfile?.groupId ?? "");
  const [serialPorts, setSerialPorts] = useState<SerialPort[]>([]);
  const [serialScanning, setSerialScanning] = useState(false);
  const [serialScanError, setSerialScanError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scanSerialPorts = useCallback(async () => {
    setSerialScanning(true);
    setSerialScanError(null);
    if (!isTauriRuntime()) {
      setSerialPorts([]);
      setSerialScanError("Automatic detection is available in the CharTerm desktop app.");
      setSerialScanning(false);
      return;
    }
    await invoke<SerialPort[]>("list_serial_ports")
      .then((ports) => {
        setSerialPorts(ports);
        if (ports.length === 1) setSerialPort((current) => current || ports[0].name);
      })
      .catch((reason) => {
        setSerialPorts([]);
        setSerialScanError(String(reason));
      })
      .finally(() => setSerialScanning(false));
  }, []);

  useEffect(() => {
    void scanSerialPorts();
  }, [scanSerialPorts]);

  const selectedProtocol = useMemo(
    () => protocols.find((item) => item.id === protocol)!,
    [protocol],
  );
  const flatGroups = useMemo(() => flattenConnectionGroups(groups), [groups]);

  const chooseProtocol = (next: QuickConnectProtocol) => {
    setProtocol(next);
    setError(null);
    if (next !== "serial" && next !== "local") setPort(defaultPorts[next]);
    if (next === "serial") void scanSerialPorts();
  };

  const serialDescription = (item: SerialPort) =>
    item.product || item.manufacturer || `${item.kind} serial device`;

  const serialMetadata = (item: SerialPort) => {
    const values = [item.kind];
    if (item.product && item.manufacturer) values.push(item.manufacturer);
    if (item.vendorId !== undefined && item.productId !== undefined) {
      values.push(`VID ${item.vendorId.toString(16).padStart(4, "0").toUpperCase()} · PID ${item.productId.toString(16).padStart(4, "0").toUpperCase()}`);
    }
    if (item.serialNumber) values.push(`S/N ${item.serialNumber}`);
    return values.join(" · ");
  };

  const saveConnection = async (openAfterSave: boolean) => {
    setError(null);
    const parsedBaudRate = Number(baudRate.trim());

    if (protocol === "local") {
      openLocalTerminal();
      return;
    }

    if (protocol === "serial" && !serialPort.trim()) {
      setError("Choose or enter a serial port, such as COM3 or /dev/ttyUSB0.");
      return;
    }
    if (protocol === "serial" && (!Number.isInteger(parsedBaudRate) || parsedBaudRate < 50 || parsedBaudRate > 4_000_000)) {
      setError("Enter a baud rate between 50 and 4,000,000.");
      return;
    }
    if (protocol !== "serial" && !host.trim()) {
      setError("Enter a host name or IP address.");
      return;
    }
    if (protocol !== "serial" && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      setError("Enter a port between 1 and 65535.");
      return;
    }
    if ((protocol === "ssh" || protocol === "sftp") && authenticationMode === "identity" && !identityId) {
      setError("Choose an SSH identity, or use Automatic authentication.");
      return;
    }
    const isPasswordProtocol = protocol === "ssh" || protocol === "sftp";
    const keepsExistingPassword = Boolean(
      editingProfile?.hasSavedPassword && isPasswordProtocol && shouldSave && savePassword,
    );
    const hasSavedPassword = Boolean(
      isPasswordProtocol && shouldSave && savePassword &&
      (password.length > 0 || keepsExistingPassword),
    );
    const draft: ConnectionDraft =
      protocol === "serial"
        ? {
            name: name.trim() || `${serialPort} serial`,
            protocol,
            serialPort: serialPort.trim(),
            baudRate: parsedBaudRate,
            serialDataBits,
            serialStopBits,
            serialParity,
            serialFlowControl,
            serialEncoding,
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
            hasSavedPassword,
            authenticationMode,
            identityId: identityId || undefined,
          };

    const id = editingProfile?.id ?? crypto.randomUUID();
    if (hasSavedPassword && password.length > 0) {
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
    if (editingProfile?.hasSavedPassword && !hasSavedPassword) {
      try {
        await invoke("delete_connection_password", { profileId: id });
      } catch (reason) {
        setError(String(reason));
        return;
      }
    }
    if (shouldSave) saveProfile(draft, id);
    if (!openAfterSave) {
      navigate("connections");
      return;
    }
    const connection: ConnectionProfile = {
      ...draft,
      id,
      favorite: editingProfile?.favorite ?? false,
      createdAt: editingProfile?.createdAt ?? Date.now(),
      lastUsedAt: editingProfile?.lastUsedAt,
    };
    openConnection(connection, hasSavedPassword ? undefined : password, keyPassphrase || undefined);
  };

  const connect = (event: FormEvent) => {
    event.preventDefault();
    void saveConnection(true);
  };

  return (
    <main className="workspace-page connection-page">
      <header className="workspace-header">
        <div>
          <span>{isEditing ? "Saved connection" : "New connection"}</span>
          <h1>{isEditing ? "Edit Connection" : "Quick Connect"}</h1>
          <p>{isEditing
            ? "Update this profile, including its connection details and protected password."
            : "Pick a protocol, enter the device details, and connect in one click."}</p>
        </div>
        {isEditing && (
          <button className="secondary-action" type="button" onClick={() => navigate("connections")}>
            <X size={16} /> Cancel editing
          </button>
        )}
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
                disabled={isEditing && id === "local"}
                title={isEditing && id === "local" ? "Local terminals are not saved profiles" : undefined}
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
              <h2>{protocol === "local" ? "Open a shell on this computer" : protocol === "serial" ? "Choose your device" : "Where should CharTerm connect?"}</h2>
            </div>
          </div>

          {protocol === "local" ? (
            <div className="local-connect-note">
              <TerminalSquare size={24} />
              <div>
                <strong>Ready immediately</strong>
                <span>CharTerm will open your operating system shell in a new terminal tab. No host, port, or login is required.</span>
              </div>
            </div>
          ) : <div className="form-grid">
            <label className="field field-wide">
              <span>Connection name <small>optional</small></span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Production server" />
            </label>

            {protocol === "serial" ? (
              <>
                <div className="serial-device-picker field-wide">
                  <div className="serial-device-heading">
                    <div>
                      <strong>Detected serial devices</strong>
                      <span>Select the COM or TTY device you want to open.</span>
                    </div>
                    <button type="button" onClick={() => void scanSerialPorts()} disabled={serialScanning}>
                      <RefreshCw className={serialScanning ? "spin" : ""} size={15} />
                      {serialScanning ? "Scanning" : "Refresh"}
                    </button>
                  </div>
                  {serialPorts.length > 0 ? (
                    <div className="serial-device-list">
                      {serialPorts.map((item) => (
                        <button
                          className={serialPort === item.name ? "selected" : ""}
                          type="button"
                          key={item.name}
                          onClick={() => setSerialPort(item.name)}
                          aria-pressed={serialPort === item.name}
                        >
                          <span className="serial-device-icon"><Cable size={18} /></span>
                          <span className="serial-device-copy">
                            <span><strong>{item.name}</strong><b>{serialDescription(item)}</b></span>
                            <small>{serialMetadata(item)}</small>
                          </span>
                          {serialPort === item.name && <CheckCircle2 className="serial-device-check" size={18} />}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="serial-device-empty">
                      <Cable size={19} />
                      <span>{serialScanning ? "Looking for connected serial devices…" : serialScanError || "No serial devices detected. Connect a device and select Refresh, or enter its port manually below."}</span>
                    </div>
                  )}
                </div>
                <label className="field">
                  <span>Port <small>select above or enter manually</small></span>
                  <input
                    list="serial-port-options"
                    value={serialPort}
                    onChange={(event) => setSerialPort(event.target.value)}
                    placeholder="COM3 or /dev/ttyUSB0"
                  />
                  <datalist id="serial-port-options">
                    {serialPorts.map((item) => <option key={item.name} value={item.name}>{item.kind}</option>)}
                  </datalist>
                </label>
                <div className="field serial-baud-field">
                  <span>Serial speed (baud) <small>choose common or type manually</small></span>
                  <div className="serial-baud-inputs">
                    <select
                      aria-label="Common serial speed"
                      value={commonBaudRates.includes(Number(baudRate)) ? baudRate : "custom"}
                      onChange={(event) => setBaudRate(event.target.value === "custom" ? "" : event.target.value)}
                    >
                      {commonBaudRates.map((rate) => <option key={rate} value={rate}>{rate.toLocaleString()} baud</option>)}
                      <option value="custom">Custom speed…</option>
                    </select>
                    <input aria-label="Manual serial speed" inputMode="numeric" pattern="[0-9]*" value={baudRate} onChange={(event) => setBaudRate(event.target.value.replace(/[^0-9]/g, ""))} placeholder="Type baud rate" aria-describedby="serial-baud-help" />
                  </div>
                  <small id="serial-baud-help" className="field-help">Manual entry is supported from 50 to 4,000,000 baud.</small>
                </div>
                <div className="field field-wide ssh-advanced-panel serial-advanced-panel">
                  <button type="button" className="ssh-advanced-toggle" onClick={() => setShowAdvancedSerial((value) => !value)} aria-expanded={showAdvancedSerial}>
                    <span><strong>Advanced serial settings</strong><small>Encoding, data bits, stop bits, parity, and flow control</small></span>
                    <b>{showAdvancedSerial ? "Hide" : "Configure"} <ChevronDown size={14} /></b>
                  </button>
                  {showAdvancedSerial && (
                    <div className="serial-advanced-grid">
                      <label className="field"><span>Character encoding</span><select value={serialEncoding} onChange={(event) => setSerialEncoding(event.target.value as SerialEncoding)}><option value="utf-8">UTF-8</option><option value="windows-1252">Windows-1252</option><option value="iso-8859-1">ISO-8859-1 / Latin-1</option></select></label>
                      <div className="serial-option"><span>Data bits</span><div>{([8, 7, 6, 5] as const).map((value) => <button className={serialDataBits === value ? "active" : ""} type="button" key={value} onClick={() => setSerialDataBits(value)}>{value}</button>)}</div></div>
                      <div className="serial-option"><span>Stop bits</span><div>{([1, 2] as const).map((value) => <button className={serialStopBits === value ? "active" : ""} type="button" key={value} onClick={() => setSerialStopBits(value)}>{value}</button>)}</div></div>
                      <div className="serial-option"><span>Parity</span><div>{(["none", "odd", "even"] as const).map((value) => <button className={serialParity === value ? "active" : ""} type="button" key={value} onClick={() => setSerialParity(value)}>{value === "none" ? "None" : value[0].toUpperCase() + value.slice(1)}</button>)}</div></div>
                      <div className="serial-option field-wide"><span>Flow control</span><div>{(["none", "hardware", "software"] as const).map((value) => <button className={serialFlowControl === value ? "active" : ""} type="button" key={value} onClick={() => setSerialFlowControl(value)}>{value === "hardware" ? "RTS/CTS" : value === "software" ? "XON/XOFF" : "None"}</button>)}</div></div>
                    </div>
                  )}
                </div>
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
                    <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder={protocol === "sftp" ? "Leave blank to sign in from the file manager" : "Leave blank to get a ‘login as’ prompt"} autoComplete="username" />
                  </label>
                  <div className="field field-wide ssh-advanced-panel auth-advanced-panel">
                    <button type="button" className="ssh-advanced-toggle" onClick={() => setShowAdvancedAuth((value) => !value)} aria-expanded={showAdvancedAuth}>
                      <span><strong>{authenticationMode === "password" ? "Password authentication" : `${authenticationMode[0].toUpperCase() + authenticationMode.slice(1)} authentication`}</strong><small>Password is the default. Open advanced mode for identities, SSH agent, or automatic fallback.</small></span>
                      <b>{showAdvancedAuth ? "Hide" : "Advanced"} <ChevronDown size={14} /></b>
                    </button>
                    {showAdvancedAuth && <div className="ssh-advanced-grid auth-advanced-grid"><div className="field field-wide auth-method-field">
                      <span>Authentication method</span>
                      <div className="auth-method-grid">
                      {([
                        ["password", "Password", "Username and account password"],
                        ["identity", "Identity", "Use one private key"],
                        ["agent", "SSH agent", "Use loaded agent keys"],
                        ["auto", "Automatic", "Identity, agent, then password"],
                      ] as const).map(([value, label, detail]) => (
                        <button type="button" className={authenticationMode === value ? "active" : ""} key={value} onClick={() => setAuthenticationMode(value)}>
                          <strong>{label}</strong><small>{detail}</small>
                        </button>
                      ))}
                      </div>
                    </div></div>}
                  </div>
                  {(authenticationMode === "auto" || authenticationMode === "identity") && (
                    <label className="field field-wide">
                      <span>SSH identity <small>{authenticationMode === "auto" ? "optional" : "required"}</small></span>
                      <select value={identityId} onChange={(event) => setIdentityId(event.target.value)}>
                        <option value="">{identities.length ? "Choose an identity" : "No identities yet — add one from SSH Identities"}</option>
                        {identities.map((identity) => <option value={identity.id} key={identity.id}>{identity.name} · {identity.algorithm}</option>)}
                      </select>
                    </label>
                  )}
                  {identityId && !identities.find((identity) => identity.id === identityId)?.hasSavedPassphrase && (
                    <label className="field field-wide">
                      <span>Private-key passphrase <small>optional, kept for this session</small></span>
                      <PasswordInput value={keyPassphrase} onChange={(event) => setKeyPassphrase(event.target.value)} autoComplete="off" />
                    </label>
                  )}
                  {(authenticationMode === "auto" || authenticationMode === "password") && (
                  <label className="field field-wide">
                    <span>Account password <small>{authenticationMode === "auto" ? "optional fallback" : "optional until prompted"}</small></span>
                    <PasswordInput value={password} onChange={(event) => setPassword(event.target.value)} placeholder={editingProfile?.hasSavedPassword ? "Saved password is hidden — enter a new one to replace it" : protocol === "sftp" ? "Leave blank to enter it in the file manager" : "Leave blank to enter it in the terminal"} autoComplete="new-password" />
                  </label>
                  )}
                  </>
                )}
              </>
            )}
          </div>}
        </section>

        <div className="security-note">
          <LockKeyhole size={17} />
          <span>
            {protocol === "local"
              ? "The local terminal runs on this computer and does not create a network connection."
              : protocol === "telnet"
              ? "Telnet is unencrypted. Use it only on trusted networks and legacy devices."
              : protocol === "tcp"
                ? "Other opens a raw, unencrypted TCP console on exactly the host and port you enter."
              : protocol === "serial"
                ? "CharTerm talks directly to the selected local serial port."
                : protocol === "sftp"
                  ? "SFTP opens CharTerm’s secure dual-pane file manager. Saved passwords are protected by your operating system vault."
                  : "Passwords and key passphrases are never stored in the profile. Save them only when you want CharTerm to protect them in the operating system vault."}
          </span>
        </div>

        {error && <div className="form-error" role="alert">{error}</div>}

        <div className="connection-form-footer">
          {protocol !== "local" && <label className="save-profile-check">
            <input type="checkbox" checked={shouldSave} disabled={isEditing} onChange={(event) => setShouldSave(event.target.checked)} />
            <Save size={16} /> {isEditing ? "Saved profile" : "Save this profile"}
          </label>}
          {protocol !== "local" && shouldSave && (
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
          {protocol !== "local" && (protocol === "ssh" || protocol === "sftp") && (authenticationMode === "auto" || authenticationMode === "password") && (
            <label className="save-profile-check secure-password-check">
              <input
                type="checkbox"
                checked={savePassword}
                disabled={!shouldSave || (password.length === 0 && !editingProfile?.hasSavedPassword)}
                onChange={(event) => setSavePassword(event.target.checked)}
              />
              <LockKeyhole size={16} /> {editingProfile?.hasSavedPassword ? "Keep password in system vault" : "Save password in system vault"}
            </label>
          )}
          {isEditing && protocol !== "local" && (
            <button className="secondary-action" type="button" onClick={() => void saveConnection(false)}>
              <Save size={16} /> Save changes
            </button>
          )}
          <button className="primary-action" type="submit">
            {protocol === "local" ? <TerminalSquare size={17} /> : <Wifi size={17} />} {protocol === "local" ? "Open local terminal" : isEditing ? "Save & connect" : `Connect with ${selectedProtocol.label}`}
          </button>
        </div>
      </form>
    </main>
  );
}
