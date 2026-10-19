use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use ssh2::{HashType, HostKeyType, KeyboardInteractivePrompt, Prompt, Session, Sftp};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, UNIX_EPOCH},
};
use tauri::{ipc::Channel, State};
use zeroize::Zeroize;

struct SftpSession {
    session: Session,
    client: Sftp,
}

struct PasswordPrompter {
    secret: String,
}

impl KeyboardInteractivePrompt for PasswordPrompter {
    fn prompt<'a>(
        &mut self,
        _username: &str,
        _instructions: &str,
        prompts: &[Prompt<'a>],
    ) -> Vec<String> {
        prompts
            .iter()
            .map(|prompt| {
                if prompt.echo {
                    String::new()
                } else {
                    self.secret.clone()
                }
            })
            .collect()
    }
}

impl Drop for PasswordPrompter {
    fn drop(&mut self) {
        self.secret.zeroize();
    }
}

type SessionMap = HashMap<String, Arc<Mutex<SftpSession>>>;

#[derive(Clone, Default)]
pub struct SftpManager {
    sessions: Arc<Mutex<SessionMap>>,
    cancellations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferEvent {
    job_id: String,
    bytes_transferred: u64,
    bytes_total: u64,
    status: String,
}

struct TransferContext {
    job_id: String,
    cancelled: Arc<AtomicBool>,
    progress: Channel<TransferEvent>,
    bytes_total: u64,
    bytes_transferred: u64,
}

impl TransferContext {
    fn emit(&self, status: &str) {
        let _ = self.progress.send(TransferEvent {
            job_id: self.job_id.clone(),
            bytes_transferred: self.bytes_transferred,
            bytes_total: self.bytes_total,
            status: status.to_string(),
        });
    }

    fn copy(&mut self, source: &mut impl Read, destination: &mut impl Write) -> Result<(), String> {
        let mut buffer = vec![0_u8; 128 * 1024];
        loop {
            if self.cancelled.load(Ordering::Relaxed) {
                self.emit("cancelled");
                return Err("Transfer cancelled.".into());
            }
            let length = source
                .read(&mut buffer)
                .map_err(|error| format!("Transfer read failed: {error}"))?;
            if length == 0 {
                break;
            }
            destination
                .write_all(&buffer[..length])
                .map_err(|error| format!("Transfer write failed: {error}"))?;
            self.bytes_transferred = self.bytes_transferred.saturating_add(length as u64);
            self.emit("running");
        }
        destination
            .flush()
            .map_err(|error| format!("Transfer flush failed: {error}"))?;
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpConnectionInfo {
    remote_home: String,
    fingerprint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    name: String,
    path: String,
    is_directory: bool,
    size: u64,
    modified: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    path: String,
    parent_path: Option<String>,
    entries: Vec<FileEntry>,
}

fn lock_error() -> String {
    "The SFTP session is unavailable because its state lock was poisoned.".into()
}

fn validate_target(host: &str, username: &str, port: u16) -> Result<(), String> {
    if host.is_empty() || host.len() > 253 || host.starts_with('-') || port == 0 {
        return Err("Enter a valid SFTP host and port.".into());
    }
    if username.is_empty() || username.len() > 128 {
        return Err("Enter the username for this SFTP server.".into());
    }
    Ok(())
}

fn fingerprint(session: &Session) -> Result<String, String> {
    let digest = session
        .host_key_hash(HashType::Sha256)
        .ok_or_else(|| "The server did not provide a usable host key.".to_string())?;
    Ok(digest
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":"))
}

fn host_key(session: &Session) -> Result<(String, String), String> {
    let (key, kind) = session
        .host_key()
        .ok_or_else(|| "The server did not provide a host key.".to_string())?;
    let key_type = match kind {
        HostKeyType::Rsa => "ssh-rsa",
        HostKeyType::Dss => "ssh-dss",
        HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
        HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
        HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
        HostKeyType::Ed25519 => "ssh-ed25519",
        HostKeyType::Unknown => "unknown",
    };
    Ok((key_type.to_string(), BASE64.encode(key)))
}

fn connect_socket(host: &str, port: u16, timeout_seconds: u16) -> Result<TcpStream, String> {
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("Unable to resolve {host}: {error}"))?;
    let timeout = Duration::from_secs(u64::from(timeout_seconds.clamp(1, 120)));
    let mut last_error = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, timeout) {
            Ok(stream) => {
                stream.set_read_timeout(Some(timeout)).ok();
                stream.set_write_timeout(Some(timeout)).ok();
                return Ok(stream);
            }
            Err(error) => last_error = Some(error),
        }
    }
    Err(format!(
        "Unable to connect to {host}:{port}: {}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "no network address was available".into())
    ))
}

fn with_session<T>(
    manager: &SftpManager,
    session_id: &str,
    operation: impl FnOnce(&mut SftpSession) -> Result<T, String>,
) -> Result<T, String> {
    let session = manager
        .sessions
        .lock()
        .map_err(|_| lock_error())?
        .get(session_id)
        .cloned()
        .ok_or_else(|| "The SFTP session is no longer connected.".to_string())?;
    let mut session = session.lock().map_err(|_| lock_error())?;
    operation(&mut session)
}

fn remote_parent(path: &str) -> Option<String> {
    let normalized = if path.is_empty() { "/" } else { path };
    if normalized == "/" {
        return None;
    }
    let trimmed = normalized.trim_end_matches('/');
    let index = trimmed.rfind('/')?;
    Some(if index == 0 {
        "/".into()
    } else {
        trimmed[..index].into()
    })
}

fn remote_name(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn is_remote_directory(permissions: Option<u32>) -> bool {
    permissions
        .map(|value| value & 0o170000 == 0o040000)
        .unwrap_or(false)
}

fn local_tree_size(path: &Path) -> u64 {
    fs::read_dir(path)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| {
            entry
                .metadata()
                .ok()
                .map(|metadata| {
                    if metadata.is_dir() {
                        local_tree_size(&entry.path())
                    } else {
                        metadata.len()
                    }
                })
                .unwrap_or(0)
        })
        .sum()
}

fn remote_tree_size(client: &Sftp, path: &Path) -> u64 {
    client
        .readdir(path)
        .ok()
        .into_iter()
        .flatten()
        .filter(|(entry, _)| {
            entry
                .file_name()
                .is_some_and(|name| name != "." && name != "..")
        })
        .map(|(entry, stat)| {
            if is_remote_directory(stat.perm) {
                remote_tree_size(client, &entry)
            } else {
                stat.size.unwrap_or(0)
            }
        })
        .sum()
}

fn download_remote_directory(
    client: &Sftp,
    remote: &Path,
    local: &Path,
    context: &mut TransferContext,
) -> Result<(), String> {
    fs::create_dir_all(local)
        .map_err(|error| format!("Unable to create local folder {}: {error}", local.display()))?;
    let entries = client
        .readdir(remote)
        .map_err(|error| format!("Unable to list remote folder {}: {error}", remote.display()))?;
    for (remote_entry, stat) in entries {
        let Some(name) = remote_entry.file_name() else {
            continue;
        };
        if name == "." || name == ".." {
            continue;
        }
        let local_entry = local.join(name);
        if is_remote_directory(stat.perm) {
            download_remote_directory(client, &remote_entry, &local_entry, context)?;
        } else {
            let mut source = client.open(&remote_entry).map_err(|error| {
                format!(
                    "Unable to open remote file {}: {error}",
                    remote_entry.display()
                )
            })?;
            let mut destination = File::create(&local_entry).map_err(|error| {
                format!(
                    "Unable to create local file {}: {error}",
                    local_entry.display()
                )
            })?;
            context.copy(&mut source, &mut destination)?;
        }
    }
    Ok(())
}

fn upload_local_directory(
    client: &Sftp,
    local: &Path,
    remote: &Path,
    context: &mut TransferContext,
) -> Result<(), String> {
    if client.stat(remote).is_err() {
        client.mkdir(remote, 0o755).map_err(|error| {
            format!(
                "Unable to create remote folder {}: {error}",
                remote.display()
            )
        })?;
    }
    let entries = fs::read_dir(local)
        .map_err(|error| format!("Unable to read local folder {}: {error}", local.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Unable to read a local item: {error}"))?;
        let local_entry = entry.path();
        let remote_entry = remote.join(entry.file_name());
        let metadata = entry
            .metadata()
            .map_err(|error| format!("Unable to inspect {}: {error}", local_entry.display()))?;
        if metadata.is_dir() {
            upload_local_directory(client, &local_entry, &remote_entry, context)?;
        } else if metadata.is_file() {
            let mut source = File::open(&local_entry).map_err(|error| {
                format!(
                    "Unable to open local file {}: {error}",
                    local_entry.display()
                )
            })?;
            let mut destination = client.create(&remote_entry).map_err(|error| {
                format!(
                    "Unable to create remote file {}: {error}",
                    remote_entry.display()
                )
            })?;
            context.copy(&mut source, &mut destination)?;
        }
    }
    Ok(())
}

fn transfer_context(
    manager: &SftpManager,
    job_id: String,
    bytes_total: u64,
    progress: Channel<TransferEvent>,
) -> Result<TransferContext, String> {
    let cancelled = Arc::new(AtomicBool::new(false));
    manager
        .cancellations
        .lock()
        .map_err(|_| lock_error())?
        .insert(job_id.clone(), Arc::clone(&cancelled));
    let context = TransferContext {
        job_id,
        cancelled,
        progress,
        bytes_total,
        bytes_transferred: 0,
    };
    context.emit("running");
    Ok(context)
}

fn finish_transfer(manager: &SftpManager, context: &TransferContext, result: &Result<(), String>) {
    context.emit(if result.is_ok() {
        "complete"
    } else if context.cancelled.load(Ordering::Relaxed) {
        "cancelled"
    } else {
        "error"
    });
    if let Ok(mut cancellations) = manager.cancellations.lock() {
        cancellations.remove(&context.job_id);
    }
}

#[tauri::command]
pub fn cancel_sftp_transfer(job_id: String, manager: State<'_, SftpManager>) -> Result<(), String> {
    let cancellation = manager
        .cancellations
        .lock()
        .map_err(|_| lock_error())?
        .get(&job_id)
        .cloned();
    if let Some(cancellation) = cancellation {
        cancellation.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub fn connect_sftp(
    session_id: String,
    host: String,
    port: u16,
    username: String,
    mut password: Option<String>,
    credential_id: Option<String>,
    authentication_mode: Option<String>,
    private_key_path: Option<String>,
    mut key_passphrase: Option<String>,
    identity_id: Option<String>,
    connection_timeout: u16,
    manager: State<'_, SftpManager>,
    database: State<'_, crate::app_database::AppDatabase>,
) -> Result<SftpConnectionInfo, String> {
    let host = host.trim();
    let username = username.trim();
    validate_target(host, username, port)?;

    if password.as_deref().is_none_or(str::is_empty) {
        password = credential_id
            .filter(|value| !value.trim().is_empty())
            .map(|value| crate::credentials::load_password(&value))
            .transpose()?;
    }
    if key_passphrase.as_deref().is_none_or(str::is_empty) {
        key_passphrase = identity_id
            .filter(|value| !value.trim().is_empty())
            .map(|value| crate::credentials::load_identity_passphrase(&value))
            .transpose()?;
    }

    let socket = connect_socket(host, port, connection_timeout)?;
    let mut session =
        Session::new().map_err(|error| format!("Unable to initialize the SFTP engine: {error}"))?;
    session.set_tcp_stream(socket);
    session
        .handshake()
        .map_err(|error| format!("Unable to negotiate SSH with {host}:{port}: {error}"))?;

    let actual_fingerprint = fingerprint(&session)?;
    let (key_type, public_key) = host_key(&session)?;
    match database.find_known_host(host, port, &key_type)? {
        Some(known)
            if known.fingerprint == actual_fingerprint && known.public_key == public_key => {}
        Some(known) => {
            return Err(format!(
                "HOST_KEY_CHANGED|{}|{}|{}|{}",
                known.fingerprint, actual_fingerprint, key_type, public_key
            ));
        }
        None => {
            return Err(format!(
                "HOST_KEY_REQUIRED|{}|{}|{}",
                actual_fingerprint, key_type, public_key
            ));
        }
    }

    let advertised_methods = session.auth_methods(username).unwrap_or("").to_string();
    let supports = |method: &str| {
        advertised_methods.is_empty() || advertised_methods.split(',').any(|value| value == method)
    };
    let mut authenticated = false;
    let authentication_mode = authentication_mode.unwrap_or_else(|| "auto".into());
    if matches!(authentication_mode.as_str(), "auto" | "identity") {
        if let Some(path) = private_key_path
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            authenticated = session
                .userauth_pubkey_file(
                    username,
                    None,
                    Path::new(path),
                    key_passphrase.as_deref().filter(|value| !value.is_empty()),
                )
                .is_ok();
        }
    }
    if !authenticated && matches!(authentication_mode.as_str(), "auto" | "agent") {
        authenticated = session.userauth_agent(username).is_ok();
    }
    if !authenticated && matches!(authentication_mode.as_str(), "auto" | "password") {
        if let Some(secret) = password.as_deref().filter(|value| !value.is_empty()) {
            if supports("password") {
                authenticated = session.userauth_password(username, secret).is_ok();
            }
            if !authenticated && supports("keyboard-interactive") {
                let mut prompter = PasswordPrompter {
                    secret: secret.to_owned(),
                };
                authenticated = session
                    .userauth_keyboard_interactive(username, &mut prompter)
                    .is_ok();
            }
        }
    }
    if let Some(secret) = password.as_mut() {
        secret.zeroize();
    }
    if let Some(secret) = key_passphrase.as_mut() {
        secret.zeroize();
    }
    if !authenticated || !session.authenticated() {
        let methods = if advertised_methods.is_empty() {
            "password, keyboard-interactive, or SSH agent"
        } else {
            advertised_methods.as_str()
        };
        return Err(format!(
            "AUTH_REQUIRED|Authentication failed for {username}. CharTerm tried the compatible sign-in methods offered by the server: {methods}. Check the username and password, or verify that this account is allowed to use SFTP."
        ));
    }

    let client = session
        .sftp()
        .map_err(|error| format!("The server did not open an SFTP channel: {error}"))?;
    let remote_home = client
        .realpath(Path::new("."))
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "/".into());

    manager.sessions.lock().map_err(|_| lock_error())?.insert(
        session_id,
        Arc::new(Mutex::new(SftpSession { session, client })),
    );
    Ok(SftpConnectionInfo {
        remote_home,
        fingerprint: actual_fingerprint,
    })
}

#[tauri::command]
pub fn close_sftp(session_id: String, manager: State<'_, SftpManager>) -> Result<(), String> {
    if let Some(session) = manager
        .sessions
        .lock()
        .map_err(|_| lock_error())?
        .remove(&session_id)
    {
        if let Ok(session) = session.lock() {
            let _ = session
                .session
                .disconnect(None, "CharTerm session closed", None);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_local_directory(path: Option<String>) -> Result<DirectoryListing, String> {
    let requested = path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."));
    let directory = requested
        .canonicalize()
        .map_err(|error| format!("Unable to open {}: {error}", requested.display()))?;
    if !directory.is_dir() {
        return Err("The selected local path is not a folder.".into());
    }
    let mut entries = fs::read_dir(&directory)
        .map_err(|error| format!("Unable to read {}: {error}", directory.display()))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            Some(FileEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: entry.path().to_string_lossy().into_owned(),
                is_directory: metadata.is_dir(),
                size: if metadata.is_file() {
                    metadata.len()
                } else {
                    0
                },
                modified: metadata
                    .modified()
                    .ok()
                    .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                    .map(|value| value.as_secs()),
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(DirectoryListing {
        path: directory.to_string_lossy().into_owned(),
        parent_path: directory
            .parent()
            .map(|value| value.to_string_lossy().into_owned()),
        entries,
    })
}

#[tauri::command]
pub fn list_remote_directory(
    session_id: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<DirectoryListing, String> {
    with_session(&manager, &session_id, |session| {
        let resolved = session
            .client
            .realpath(Path::new(path.trim()))
            .map_err(|error| format!("Unable to open remote folder {path}: {error}"))?;
        let resolved_string = resolved.to_string_lossy().into_owned();
        let mut entries = session
            .client
            .readdir(&resolved)
            .map_err(|error| format!("Unable to read remote folder {resolved_string}: {error}"))?
            .into_iter()
            .filter_map(|(entry_path, stat)| {
                let name = remote_name(&entry_path);
                if name == "." || name == ".." {
                    return None;
                }
                Some(FileEntry {
                    name,
                    path: entry_path.to_string_lossy().into_owned(),
                    is_directory: is_remote_directory(stat.perm),
                    size: stat.size.unwrap_or(0),
                    modified: stat.mtime,
                })
            })
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| {
            right
                .is_directory
                .cmp(&left.is_directory)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        Ok(DirectoryListing {
            parent_path: remote_parent(&resolved_string),
            path: resolved_string,
            entries,
        })
    })
}

#[tauri::command]
pub async fn sftp_upload(
    session_id: String,
    local_path: String,
    remote_path: String,
    job_id: String,
    on_progress: Channel<TransferEvent>,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let source_path = PathBuf::from(&local_path);
        if !source_path.is_file() {
            return Err("Select a local file to upload.".into());
        }
        let total = source_path.metadata().map(|value| value.len()).unwrap_or(0);
        let mut context = transfer_context(&manager, job_id, total, on_progress)?;
        let result = with_session(&manager, &session_id, |session| {
            let mut source = File::open(&source_path)
                .map_err(|error| format!("Unable to open local file {local_path}: {error}"))?;
            let mut destination = session
                .client
                .create(Path::new(&remote_path))
                .map_err(|error| format!("Unable to create remote file {remote_path}: {error}"))?;
            context.copy(&mut source, &mut destination)
        });
        finish_transfer(&manager, &context, &result);
        result
    })
    .await
    .map_err(|error| format!("Upload job stopped unexpectedly: {error}"))?
}

#[tauri::command]
pub async fn sftp_upload_directory(
    session_id: String,
    local_path: String,
    remote_path: String,
    job_id: String,
    on_progress: Channel<TransferEvent>,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let source_path = PathBuf::from(&local_path);
        if !source_path.is_dir() {
            return Err("Select a local folder to upload.".into());
        }
        let mut context =
            transfer_context(&manager, job_id, local_tree_size(&source_path), on_progress)?;
        let result = with_session(&manager, &session_id, |session| {
            upload_local_directory(
                &session.client,
                &source_path,
                Path::new(&remote_path),
                &mut context,
            )
        });
        finish_transfer(&manager, &context, &result);
        result
    })
    .await
    .map_err(|error| format!("Folder upload job stopped unexpectedly: {error}"))?
}

#[tauri::command]
pub async fn sftp_download(
    session_id: String,
    remote_path: String,
    local_path: String,
    job_id: String,
    on_progress: Channel<TransferEvent>,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let total = with_session(&manager, &session_id, |session| {
            session
                .client
                .stat(Path::new(&remote_path))
                .map(|value| value.size.unwrap_or(0))
                .map_err(|error| error.to_string())
        })?;
        let mut context = transfer_context(&manager, job_id, total, on_progress)?;
        let result = with_session(&manager, &session_id, |session| {
            let mut source = session
                .client
                .open(Path::new(&remote_path))
                .map_err(|error| format!("Unable to open remote file {remote_path}: {error}"))?;
            let mut destination = File::create(&local_path)
                .map_err(|error| format!("Unable to create local file {local_path}: {error}"))?;
            context.copy(&mut source, &mut destination)
        });
        finish_transfer(&manager, &context, &result);
        result
    })
    .await
    .map_err(|error| format!("Download job stopped unexpectedly: {error}"))?
}

#[tauri::command]
pub async fn sftp_download_directory(
    session_id: String,
    remote_path: String,
    local_path: String,
    job_id: String,
    on_progress: Channel<TransferEvent>,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let manager = manager.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let total = with_session(&manager, &session_id, |session| {
            Ok(remote_tree_size(&session.client, Path::new(&remote_path)))
        })?;
        let mut context = transfer_context(&manager, job_id, total, on_progress)?;
        let result = with_session(&manager, &session_id, |session| {
            download_remote_directory(
                &session.client,
                Path::new(&remote_path),
                Path::new(&local_path),
                &mut context,
            )
        });
        finish_transfer(&manager, &context, &result);
        result
    })
    .await
    .map_err(|error| format!("Folder download job stopped unexpectedly: {error}"))?
}

#[tauri::command]
pub fn sftp_create_directory(
    session_id: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    with_session(&manager, &session_id, |session| {
        session
            .client
            .mkdir(Path::new(&path), 0o755)
            .map_err(|error| format!("Unable to create remote folder {path}: {error}"))
    })
}

#[tauri::command]
pub fn sftp_rename(
    session_id: String,
    from_path: String,
    to_path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    with_session(&manager, &session_id, |session| {
        session
            .client
            .rename(Path::new(&from_path), Path::new(&to_path), None)
            .map_err(|error| format!("Unable to rename {from_path}: {error}"))
    })
}

#[tauri::command]
pub fn sftp_delete(
    session_id: String,
    path: String,
    is_directory: bool,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    with_session(&manager, &session_id, |session| {
        let result = if is_directory {
            session.client.rmdir(Path::new(&path))
        } else {
            session.client.unlink(Path::new(&path))
        };
        result.map_err(|error| {
            if is_directory {
                format!("Unable to delete {path}. The folder must be empty: {error}")
            } else {
                format!("Unable to delete {path}: {error}")
            }
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_parent_handles_root_and_nested_paths() {
        assert_eq!(remote_parent("/"), None);
        assert_eq!(remote_parent("/home"), Some("/".into()));
        assert_eq!(remote_parent("/home/user/"), Some("/home".into()));
    }

    #[test]
    fn directory_mode_is_detected() {
        assert!(is_remote_directory(Some(0o040755)));
        assert!(!is_remote_directory(Some(0o100644)));
    }

    #[test]
    fn keyboard_interactive_uses_the_secret_only_for_hidden_prompts() {
        let mut prompter = PasswordPrompter {
            secret: "correct horse".into(),
        };
        let prompts = [
            Prompt {
                text: "Password:".into(),
                echo: false,
            },
            Prompt {
                text: "Visible information:".into(),
                echo: true,
            },
        ];

        assert_eq!(
            prompter.prompt("root", "", &prompts),
            vec!["correct horse".to_string(), String::new()]
        );
    }
}
