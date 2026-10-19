import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  Copy,
  FileKey2,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { PasswordInput } from "../../components/PasswordInput";
import { useAppStore, type SshIdentity } from "../../stores/useAppStore";

type Inspection = {
  privateKeyPath: string;
  publicKeyPath?: string;
  publicKey?: string;
  fingerprint: string;
  algorithm: string;
};
type ToolStatus = { nativeGenerator: boolean };
type Mode = "closed" | "generate" | "import" | "edit" | "passphrase" | "install";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function IdentitiesPage() {
  const identities = useAppStore((state) => state.identities).filter(
    (identity): identity is SshIdentity => Boolean(
      identity && typeof identity.id === "string" && typeof identity.name === "string" &&
      typeof identity.privateKeyPath === "string",
    ),
  );
  const profiles = useAppStore((state) => state.profiles).filter(
    (profile) => Boolean(profile && typeof profile.id === "string" && typeof profile.protocol === "string"),
  );
  const saveIdentity = useAppStore((state) => state.saveIdentity);
  const deleteIdentity = useAppStore((state) => state.deleteIdentity);
  const [mode, setMode] = useState<Mode>("closed");
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [algorithm, setAlgorithm] = useState("ed25519");
  const [passphrase, setPassphrase] = useState("");
  const [savePassphrase, setSavePassphrase] = useState(false);
  const [certificatePath, setCertificatePath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [installIdentityId, setInstallIdentityId] = useState("");
  const [installProfileId, setInstallProfileId] = useState("");
  const [installPassword, setInstallPassword] = useState("");
  const [trustedFingerprint, setTrustedFingerprint] = useState("");
  const [installHostKeyType, setInstallHostKeyType] = useState("");
  const [installHostPublicKey, setInstallHostPublicKey] = useState("");
  const [installHostKeyChanged, setInstallHostKeyChanged] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [currentPassphrase, setCurrentPassphrase] = useState("");

  const sshProfiles = useMemo(
    () => profiles.filter((profile) => profile.protocol === "ssh" || profile.protocol === "sftp"),
    [profiles],
  );

  useEffect(() => {
    if (isTauriRuntime()) {
      void invoke<ToolStatus>("get_ssh_tool_status")
        .then(setTools)
        .catch((reason) => setError(`SSH identity tools could not be initialized: ${String(reason)}`));
    }
  }, []);

  const reset = (next: Mode) => {
    setMode(next);
    setName("");
    setPath("");
    setPassphrase("");
    setSavePassphrase(false);
    setCertificatePath("");
    setError(null);
    setSuccess(null);
    setTrustedFingerprint("");
    setInstallHostKeyType(""); setInstallHostPublicKey(""); setInstallHostKeyChanged(false);
    setEditingId("");
    setCurrentPassphrase("");
  };

  const editIdentity = (identity: SshIdentity) => {
    setMode("edit"); setEditingId(identity.id); setName(identity.name); setPath(identity.privateKeyPath);
    setCertificatePath(identity.certificatePath ?? ""); setSavePassphrase(Boolean(identity.hasSavedPassphrase));
    setPassphrase(""); setError(null); setSuccess(null);
  };

  const editPassphrase = (identity: SshIdentity) => {
    setMode("passphrase"); setEditingId(identity.id); setName(identity.name); setPath(identity.privateKeyPath);
    setCurrentPassphrase(""); setPassphrase(""); setSavePassphrase(Boolean(identity.hasSavedPassphrase)); setError(null);
  };

  const choosePrivateKey = async () => {
    try {
      const selected = await open({ multiple: false, title: "Choose an OpenSSH private key" });
      if (typeof selected === "string") setPath(selected);
    } catch (reason) {
      setError(`The private-key picker could not be opened: ${String(reason)}`);
    }
  };

  const chooseCertificate = async () => {
    try {
      const selected = await open({ multiple: false, title: "Choose an OpenSSH certificate", filters: [{ name: "OpenSSH certificate", extensions: ["pub"] }] });
      if (typeof selected === "string") setCertificatePath(selected);
    } catch (reason) {
      setError(`The certificate picker could not be opened: ${String(reason)}`);
    }
  };

  const chooseGeneratedPath = async () => {
    try {
      const selected = await save({ title: "Save private key", defaultPath: algorithm === "ed25519" ? "id_ed25519" : "id_rsa" });
      if (selected) setPath(selected);
    } catch (reason) {
      setError(`The key destination picker could not be opened: ${String(reason)}`);
    }
  };

  const copyPublicKey = async (identity: SshIdentity) => {
    if (!identity.publicKey) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(identity.publicKey);
      } else {
        const temporary = document.createElement("textarea");
        temporary.value = identity.publicKey;
        temporary.style.position = "fixed";
        temporary.style.opacity = "0";
        document.body.appendChild(temporary);
        temporary.select();
        if (!document.execCommand("copy")) throw new Error("Clipboard access is unavailable.");
        temporary.remove();
      }
      setSuccess("Public key copied to the clipboard.");
    } catch (reason) {
      setError(`The public key could not be copied: ${String(reason)}`);
    }
  };

  const storeInspection = async (inspection: Inspection) => {
    const existing = identities.find((item) => item.id === editingId);
    const id = existing?.id ?? crypto.randomUUID();
    saveIdentity({
      name: name.trim() || inspection.algorithm.toUpperCase(),
      ...inspection,
      certificatePath: certificatePath || undefined,
      hasSavedPassphrase: savePassphrase && (Boolean(passphrase) || Boolean(existing?.hasSavedPassphrase)),
    }, id);
    if (savePassphrase && passphrase) {
      await invoke("save_identity_passphrase", { identityId: id, passphrase });
    } else if (!savePassphrase && existing?.hasSavedPassphrase) {
      await invoke("delete_identity_passphrase", { identityId: id });
    }
    setPassphrase("");
    setSuccess("Identity is ready to use in Quick Connect and saved profiles.");
    setMode("closed");
  };

  const submitIdentity = async (event: FormEvent) => {
    event.preventDefault();
    if (!path.trim()) { setError("Choose where to save the key or select an existing private key."); return; }
    setBusy(true);
    setError(null);
    try {
      const inspection = mode === "generate"
        ? await invoke<Inspection>("generate_ssh_identity", {
            privateKeyPath: path,
            algorithm,
            comment: name.trim() || "CharTerm identity",
            passphrase,
          })
        : await invoke<Inspection>("inspect_ssh_identity", {
            privateKeyPath: path,
            publicKeyPath: null,
            passphrase: passphrase || null,
          });
      await storeInspection(inspection);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const submitPassphrase = async (event: FormEvent) => {
    event.preventDefault();
    const identity = identities.find((item) => item.id === editingId);
    if (!identity) return;
    setBusy(true); setError(null);
    try {
      await invoke("change_identity_passphrase", { privateKeyPath: identity.privateKeyPath, currentPassphrase, newPassphrase: passphrase });
      if (savePassphrase && passphrase) await invoke("save_identity_passphrase", { identityId: identity.id, passphrase });
      else if (!savePassphrase && identity.hasSavedPassphrase) await invoke("delete_identity_passphrase", { identityId: identity.id });
      saveIdentity({ ...identity, hasSavedPassphrase: savePassphrase && Boolean(passphrase) }, identity.id);
      setCurrentPassphrase(""); setPassphrase(""); setSuccess("Private-key passphrase updated safely."); setMode("closed");
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };

  const installKey = async (event: FormEvent) => {
    event.preventDefault();
    const identity = identities.find((item) => item.id === installIdentityId);
    const profile = sshProfiles.find((item) => item.id === installProfileId);
    if (!identity?.publicKey || !profile?.host || !profile.port || !profile.username) {
      setError("Choose an identity with a public key and a saved connection with a username.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (trustedFingerprint && installHostKeyType && installHostPublicKey) {
        const now = Date.now();
        await invoke("trust_known_host", { host: { host: profile.host, port: profile.port, keyType: installHostKeyType, fingerprint: trustedFingerprint, publicKey: installHostPublicKey, firstSeenAt: now, lastSeenAt: now } });
      }
      await invoke("install_public_key", {
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password: installPassword,
        publicKey: identity.publicKey,
      });
      setInstallPassword("");
      setSuccess(`Public key installed for ${profile.username}@${profile.host}. Test the identity before removing password access on the server.`);
      setMode("closed");
    } catch (reason) {
      const message = String(reason);
      if (message.includes("HOST_KEY_REQUIRED|") || message.includes("HOST_KEY_CHANGED|")) {
        const changed = message.includes("HOST_KEY_CHANGED|");
        const payload = message.split(changed ? "HOST_KEY_CHANGED|" : "HOST_KEY_REQUIRED|")[1] ?? "";
        const parts = payload.split("|");
        const fingerprint = changed ? parts[1] : parts[0];
        setTrustedFingerprint(fingerprint);
        setInstallHostKeyType(changed ? parts[2] : parts[1]); setInstallHostPublicKey(changed ? parts[3] : parts[2]); setInstallHostKeyChanged(changed);
        setError(`${changed ? "The saved server key changed. " : ""}Verify this server fingerprint, then select Install again: ${fingerprint}`);
      } else setError(message);
    } finally {
      setBusy(false);
    }
  };

  const removeIdentity = async (identity: SshIdentity) => {
    if (!window.confirm(`Remove “${identity.name}” from CharTerm? The key files will stay on your computer.`)) return;
    if (identity.hasSavedPassphrase) await invoke("delete_identity_passphrase", { identityId: identity.id }).catch(() => undefined);
    deleteIdentity(identity.id);
  };

  return (
    <main className="workspace-page identities-page">
      <header className="workspace-header identity-header">
        <div><span>Security workspace</span><h1>SSH Identities</h1><p>Create once, reuse safely across SSH and SFTP connections. Private keys remain on this computer.</p></div>
        <div className="identity-header-actions">
          <button className="secondary-action" type="button" onClick={() => reset("import")}><Upload size={16} /> Import key</button>
          <button className="primary-action" type="button" onClick={() => reset("generate")}><Plus size={16} /> Generate identity</button>
        </div>
      </header>

      {error && <div className="identity-notice error">{error}<button type="button" onClick={() => setError(null)}><X size={15} /></button></div>}
      {success && <div className="identity-notice success"><CheckCircle2 size={16} />{success}<button type="button" onClick={() => setSuccess(null)}><X size={15} /></button></div>}

      <section className="identity-overview">
        <div><ShieldCheck size={22} /><span><strong>Local-first key storage</strong><small>Passwords and passphrases enter the operating-system vault only when you choose to save them.</small></span></div>
        <div><WandSparkles size={22} /><span><strong>Modern defaults</strong><small>Ed25519 is recommended. RSA 4096 is available for older devices.</small></span></div>
        <div><Server size={22} /><span><strong>Easy deployment</strong><small>Install a public key using a saved server profile and a one-time password.</small></span></div>
      </section>

      {mode === "closed" && identities.length === 0 ? (
        <section className="identity-empty"><span><FileKey2 size={30} /></span><h2>No SSH identities yet</h2><p>Generate a protected OpenSSH key or import one you already use. CharTerm will never copy private-key contents into browser storage.</p><button className="primary-action" type="button" onClick={() => reset("generate")}><KeyRound size={16} /> Create first identity</button></section>
      ) : mode === "closed" ? (
        <>
          <section className="identity-section-heading"><div><span className="section-kicker">Your keys</span><h2>{identities.length} reusable {identities.length === 1 ? "identity" : "identities"}</h2></div><button className="secondary-action" type="button" onClick={() => reset("install")} disabled={!identities.some((item) => item.publicKey) || sshProfiles.length === 0}><Server size={16} /> Install public key</button></section>
          <div className="identity-grid">
            {identities.map((identity) => (
              <article className="identity-card" key={identity.id}>
                <div className="identity-card-top"><span><KeyRound size={21} /></span><div><h3>{identity.name}</h3><small>{identity.algorithm} · {identity.hasSavedPassphrase ? "Passphrase in vault" : "Passphrase not stored"}</small></div><button type="button" onClick={() => void removeIdentity(identity)} title="Remove identity"><Trash2 size={15} /></button></div>
                <div className="identity-fingerprint"><Fingerprint size={15} /><code>{identity.fingerprint}</code></div>
                <div className="identity-path"><span>Private key</span><code title={identity.privateKeyPath}>{identity.privateKeyPath}</code></div>
                {identity.certificatePath && <div className="identity-path"><span>Certificate</span><code>{identity.certificatePath}</code></div>}
                <div className="identity-card-actions"><button type="button" disabled={!identity.publicKey} onClick={() => void copyPublicKey(identity)}><Copy size={14} /> Copy public key</button><button type="button" onClick={() => editIdentity(identity)}><Pencil size={14} /> Edit</button><button type="button" onClick={() => editPassphrase(identity)}><ShieldCheck size={14} /> Passphrase</button></div>
              </article>
            ))}
          </div>
        </>
      ) : mode === "install" ? (
        <form className="identity-editor" onSubmit={installKey}>
          <div className="identity-editor-title"><span><Server size={22} /></span><div><span className="section-kicker">Guided setup</span><h2>Install a public key</h2><p>CharTerm signs in once with the account password and safely appends the selected key.</p></div></div>
          <div className="form-grid">
            <label className="field"><span>Identity</span><select value={installIdentityId} onChange={(event) => setInstallIdentityId(event.target.value)}><option value="">Choose an identity</option>{identities.filter((item) => item.publicKey).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="field"><span>Saved connection</span><select value={installProfileId} onChange={(event) => setInstallProfileId(event.target.value)}><option value="">Choose a server</option>{sshProfiles.filter((item) => item.username).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.username}@{item.host}</option>)}</select></label>
            <label className="field field-wide"><span>Current account password <small>used once, not saved</small></span><PasswordInput value={installPassword} onChange={(event) => setInstallPassword(event.target.value)} /></label>
          </div>
          {trustedFingerprint && <div className="identity-fingerprint confirm"><ShieldCheck size={16} /><div><strong>{installHostKeyChanged ? "Warning: server identity changed" : "Confirm server fingerprint"}</strong><code>{trustedFingerprint}</code></div></div>}
          <div className="form-actions"><button className="secondary-action" type="button" onClick={() => reset("closed")}>Cancel</button><button className="primary-action" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : <Server size={16} />} {trustedFingerprint ? "Confirm & install" : "Check server"}</button></div>
        </form>
      ) : mode === "passphrase" ? (
        <form className="identity-editor" onSubmit={submitPassphrase}>
          <div className="identity-editor-title"><span><ShieldCheck size={22} /></span><div><span className="section-kicker">Key protection</span><h2>Change passphrase</h2><p>CharTerm writes the replacement atomically and rolls back if the update cannot be completed.</p></div></div>
          <div className="form-grid"><label className="field field-wide"><span>Current passphrase <small>leave blank if unencrypted</small></span><PasswordInput value={currentPassphrase} onChange={(event) => setCurrentPassphrase(event.target.value)} /></label><label className="field field-wide"><span>New passphrase <small>leave blank to remove protection</small></span><PasswordInput value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label></div>
          <label className="secure-option"><input type="checkbox" checked={savePassphrase} disabled={!passphrase} onChange={(event) => setSavePassphrase(event.target.checked)} /><LockCopy /> Save new passphrase in the operating-system credential vault</label>
          <div className="form-actions"><button className="secondary-action" type="button" onClick={() => reset("closed")}>Cancel</button><button className="primary-action" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />} Update passphrase</button></div>
        </form>
      ) : (
        <form className="identity-editor" onSubmit={submitIdentity}>
          <div className="identity-editor-title"><span>{mode === "generate" ? <WandSparkles size={22} /> : mode === "edit" ? <Pencil size={22} /> : <Upload size={22} />}</span><div><span className="section-kicker">{mode === "generate" ? "New identity" : mode === "edit" ? "Identity details" : "Existing identity"}</span><h2>{mode === "generate" ? "Generate an OpenSSH key" : mode === "edit" ? "Edit identity" : "Import an OpenSSH private key"}</h2><p>{mode === "generate" ? "Use Ed25519 unless an older server specifically requires RSA." : "CharTerm stores the path and fingerprint—not the private-key contents."}</p></div></div>
          <div className="form-grid">
            <label className="field"><span>Identity name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Work servers" autoFocus /></label>
            {mode === "generate" && <label className="field"><span>Algorithm</span><select value={algorithm} onChange={(event) => setAlgorithm(event.target.value)}><option value="ed25519">Ed25519 (recommended)</option><option value="rsa">RSA 4096 (compatibility)</option></select></label>}
            <label className="field field-wide"><span>{mode === "generate" ? "Private key destination" : "Private key file"}</span><div className="path-picker"><input value={path} disabled={mode === "edit"} onChange={(event) => setPath(event.target.value)} placeholder="Choose a key file…" />{mode !== "edit" && <button type="button" onClick={() => void (mode === "generate" ? chooseGeneratedPath() : choosePrivateKey())}>Browse</button>}</div></label>
            <label className="field field-wide"><span>OpenSSH certificate <small>optional, *-cert.pub</small></span><div className="path-picker"><input value={certificatePath} onChange={(event) => setCertificatePath(event.target.value)} placeholder="No certificate selected" /><button type="button" onClick={() => void chooseCertificate()}>Browse</button></div></label>
            <label className="field field-wide"><span>Private-key passphrase <small>{mode === "generate" ? "recommended" : "only if this key is encrypted"}</small></span><PasswordInput value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="off" /></label>
          </div>
          <label className="secure-option"><input type="checkbox" checked={savePassphrase} disabled={!passphrase} onChange={(event) => setSavePassphrase(event.target.checked)} /><LockCopy /> Save passphrase in the operating-system credential vault</label>
          {tools?.nativeGenerator && mode === "generate" && <div className="identity-native-note"><ShieldCheck size={15} /> Generated privately inside CharTerm—PuTTY and ssh-keygen are not required.</div>}
          <div className="form-actions"><button className="secondary-action" type="button" onClick={() => reset("closed")}>Cancel</button><button className="primary-action" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />} {mode === "generate" ? "Generate identity" : mode === "edit" ? "Save identity" : "Import identity"}</button></div>
        </form>
      )}
    </main>
  );
}

function LockCopy() {
  return <><ShieldCheck size={16} /></>;
}
