use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
};
use tauri::{ipc::Channel, State};
use zeroize::Zeroize;

type SessionMap = HashMap<String, Arc<LocalTerminalSession>>;

#[derive(Default)]
pub struct LocalTerminalManager {
    sessions: Arc<Mutex<SessionMap>>,
}

struct LocalTerminalSession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum TerminalEvent {
    Output { data: Vec<u8> },
    Exit,
    Error { message: String },
}

fn lock_error() -> String {
    "The local terminal session is unavailable because its state lock was poisoned.".into()
}

fn create_shell_command(working_directory: Option<String>) -> Result<CommandBuilder, String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = CommandBuilder::new("powershell.exe");
        command.arg("-NoLogo");
        command
    };

    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        CommandBuilder::new(shell)
    };

    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");

    if let Some(directory) = working_directory.filter(|value| !value.trim().is_empty()) {
        let path = PathBuf::from(directory);
        if !path.is_dir() {
            return Err("The selected terminal working directory does not exist.".into());
        }
        command.cwd(path);
    }

    Ok(command)
}

fn validate_ssh_target(host: &str, username: &str, port: u16) -> Result<(), String> {
    if host.is_empty() || host.len() > 253 || host.starts_with('-') {
        return Err("Enter a valid host name or IP address.".into());
    }
    if !host
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || ".-:[]".contains(character))
    {
        return Err("The host contains unsupported characters.".into());
    }
    if username.len() > 64 || username.starts_with('-') {
        return Err("Enter a valid SSH username.".into());
    }
    if !username
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
    {
        return Err("The SSH username contains unsupported characters.".into());
    }
    if port == 0 {
        return Err("The SSH port must be between 1 and 65535.".into());
    }
    Ok(())
}

fn start_terminal_session(
    session_id: String,
    cols: u16,
    rows: u16,
    command: CommandBuilder,
    process_label: &str,
    mut password: Option<String>,
    on_event: Channel<TerminalEvent>,
    manager: &LocalTerminalManager,
) -> Result<(), String> {
    if session_id.trim().is_empty() {
        return Err("A terminal session identifier is required.".into());
    }

    let mut sessions = manager.sessions.lock().map_err(|_| lock_error())?;
    if sessions.contains_key(&session_id) {
        return Err("A terminal with this identifier is already running.".into());
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Unable to create the terminal: {error}"))?;

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Unable to start {process_label}: {error}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Unable to read terminal output: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Unable to write terminal input: {error}"))?;

    let session = Arc::new(LocalTerminalSession {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
    });

    let reader_session = Arc::clone(&session);
    sessions.insert(session_id.clone(), session);
    drop(sessions);

    let session_map = Arc::clone(&manager.sessions);
    thread::spawn(move || {
        let mut buffer = vec![0_u8; 16 * 1024];
        let mut prompt_tail = String::new();

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    if password.is_some() {
                        let output = String::from_utf8_lossy(&buffer[..length]).to_lowercase();
                        prompt_tail = format!("{prompt_tail}{output}");
                        prompt_tail = prompt_tail
                            .chars()
                            .rev()
                            .take(256)
                            .collect::<Vec<_>>()
                            .into_iter()
                            .rev()
                            .collect();
                        if prompt_tail.contains("password:") {
                            if let Some(mut secret) = password.take() {
                                if let Ok(mut writer) = reader_session.writer.lock() {
                                    let _ = writer.write_all(secret.as_bytes());
                                    let _ = writer.write_all(b"\r");
                                    let _ = writer.flush();
                                }
                                secret.zeroize();
                            }
                        }
                    }
                    if on_event
                        .send(TerminalEvent::Output {
                            data: buffer[..length].to_vec(),
                        })
                        .is_err()
                    {
                        break;
                    }
                }
                Err(error) => {
                    let _ = on_event.send(TerminalEvent::Error {
                        message: format!("Terminal output stopped: {error}"),
                    });
                    break;
                }
            }
        }

        if let Ok(mut sessions) = session_map.lock() {
            sessions.remove(&session_id);
        }
        let _ = on_event.send(TerminalEvent::Exit);
    });

    Ok(())
}

#[tauri::command]
pub fn create_local_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    working_directory: Option<String>,
    on_event: Channel<TerminalEvent>,
    manager: State<'_, LocalTerminalManager>,
) -> Result<(), String> {
    let command = create_shell_command(working_directory)?;
    start_terminal_session(
        session_id,
        cols,
        rows,
        command,
        "the local shell",
        None,
        on_event,
        &manager,
    )
}

#[tauri::command]
pub fn create_ssh_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    host: String,
    port: u16,
    username: String,
    connection_timeout: u16,
    keepalive_seconds: u16,
    allow_legacy_ssh_rsa: bool,
    allow_legacy_mac_sha1: bool,
    allow_legacy_kex_sha1: bool,
    allow_legacy_ciphers: bool,
    password: Option<String>,
    credential_id: Option<String>,
    on_event: Channel<TerminalEvent>,
    manager: State<'_, LocalTerminalManager>,
) -> Result<(), String> {
    let host = host.trim();
    let username = username.trim();
    validate_ssh_target(host, username, port)?;

    let mut command = CommandBuilder::new("ssh");
    command.arg("-p");
    command.arg(port.to_string());
    command.arg("-o");
    command.arg(format!(
        "ConnectTimeout={}",
        connection_timeout.clamp(1, 120)
    ));
    command.arg("-o");
    command.arg(format!(
        "ServerAliveInterval={}",
        keepalive_seconds.min(3600)
    ));
    if !username.is_empty() {
        command.arg("-l");
        command.arg(username);
    }
    if allow_legacy_ssh_rsa {
        command.arg("-o");
        command.arg("HostKeyAlgorithms=+ssh-rsa");
        command.arg("-o");
        command.arg("PubkeyAcceptedAlgorithms=+ssh-rsa");
    }
    if allow_legacy_mac_sha1 {
        command.arg("-o");
        command.arg("MACs=+hmac-sha1,hmac-sha1-96");
    }
    if allow_legacy_kex_sha1 {
        command.arg("-o");
        command.arg("KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group1-sha1,diffie-hellman-group-exchange-sha1");
    }
    if allow_legacy_ciphers {
        command.arg("-o");
        command.arg("Ciphers=+aes128-cbc,aes192-cbc,aes256-cbc,3des-cbc");
    }
    command.arg(host);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");

    let password = match password.filter(|value| !value.is_empty()) {
        Some(password) => Some(password),
        None => credential_id
            .as_deref()
            .map(crate::credentials::load_password)
            .transpose()?,
    };

    start_terminal_session(
        session_id,
        cols,
        rows,
        command,
        "the SSH client (make sure OpenSSH is installed)",
        password,
        on_event,
        &manager,
    )
}

#[tauri::command]
pub fn create_sftp_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    host: String,
    port: u16,
    username: String,
    connection_timeout: u16,
    allow_legacy_ssh_rsa: bool,
    allow_legacy_mac_sha1: bool,
    allow_legacy_kex_sha1: bool,
    allow_legacy_ciphers: bool,
    password: Option<String>,
    credential_id: Option<String>,
    on_event: Channel<TerminalEvent>,
    manager: State<'_, LocalTerminalManager>,
) -> Result<(), String> {
    let host = host.trim();
    let username = username.trim();
    validate_ssh_target(host, username, port)?;

    let mut command = CommandBuilder::new("sftp");
    command.arg("-P");
    command.arg(port.to_string());
    command.arg("-o");
    command.arg(format!(
        "ConnectTimeout={}",
        connection_timeout.clamp(1, 120)
    ));
    if allow_legacy_ssh_rsa {
        command.arg("-o");
        command.arg("HostKeyAlgorithms=+ssh-rsa");
        command.arg("-o");
        command.arg("PubkeyAcceptedAlgorithms=+ssh-rsa");
    }
    if allow_legacy_mac_sha1 {
        command.arg("-o");
        command.arg("MACs=+hmac-sha1,hmac-sha1-96");
    }
    if allow_legacy_kex_sha1 {
        command.arg("-o");
        command.arg("KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group1-sha1,diffie-hellman-group-exchange-sha1");
    }
    if allow_legacy_ciphers {
        command.arg("-o");
        command.arg("Ciphers=+aes128-cbc,aes192-cbc,aes256-cbc,3des-cbc");
    }
    command.arg(if username.is_empty() {
        host.to_string()
    } else {
        format!("{username}@{host}")
    });
    command.env("TERM", "xterm-256color");

    let password = match password.filter(|value| !value.is_empty()) {
        Some(password) => Some(password),
        None => credential_id
            .as_deref()
            .map(crate::credentials::load_password)
            .transpose()?,
    };

    start_terminal_session(
        session_id,
        cols,
        rows,
        command,
        "the SFTP client (make sure OpenSSH is installed)",
        password,
        on_event,
        &manager,
    )
}

#[tauri::command]
pub fn write_local_terminal(
    session_id: String,
    data: String,
    manager: State<'_, LocalTerminalManager>,
) -> Result<(), String> {
    let session = manager
        .sessions
        .lock()
        .map_err(|_| lock_error())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "The local terminal session is no longer running.".to_string())?;

    let mut writer = session.writer.lock().map_err(|_| lock_error())?;
    writer
        .write_all(data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|error| format!("Unable to send input to the local terminal: {error}"))
}

#[tauri::command]
pub fn resize_local_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    manager: State<'_, LocalTerminalManager>,
) -> Result<(), String> {
    let session = manager
        .sessions
        .lock()
        .map_err(|_| lock_error())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "The local terminal session is no longer running.".to_string())?;

    let result = session
        .master
        .lock()
        .map_err(|_| lock_error())?
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Unable to resize the local terminal: {error}"));

    result
}

#[tauri::command]
pub fn close_local_terminal(
    session_id: String,
    manager: State<'_, LocalTerminalManager>,
) -> Result<(), String> {
    let session = manager
        .sessions
        .lock()
        .map_err(|_| lock_error())?
        .remove(&session_id);

    if let Some(session) = session {
        session
            .child
            .lock()
            .map_err(|_| lock_error())?
            .kill()
            .map_err(|error| format!("Unable to stop the local terminal: {error}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_target_validation_rejects_command_options() {
        assert!(validate_ssh_target("-oBadOption", "admin", 22).is_err());
        assert!(validate_ssh_target("server.example", "-bad", 22).is_err());
        assert!(validate_ssh_target("server.example", "admin", 22).is_ok());
    }

    #[test]
    fn native_pty_runs_the_platform_shell() {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("the native PTY should open");
        let mut command =
            create_shell_command(None).expect("the default shell command should be valid");

        #[cfg(target_os = "windows")]
        {
            command.arg("-NonInteractive");
            command.arg("-Command");
            command.arg("Write-Output CHARTERM_PTY_OK");
        }

        #[cfg(not(target_os = "windows"))]
        {
            command.arg("-lc");
            command.arg("printf CHARTERM_PTY_OK");
        }

        let mut child = pair
            .slave
            .spawn_command(command)
            .expect("the shell should start");
        drop(pair.slave);
        let mut reader = pair
            .master
            .try_clone_reader()
            .expect("PTY output should be readable");
        let mut writer = pair
            .master
            .take_writer()
            .expect("PTY input should be writable");
        let (sender, receiver) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let mut output = Vec::new();
            let mut chunk = vec![0_u8; 4096];
            loop {
                let length = reader
                    .read(&mut chunk)
                    .expect("PTY output should be readable");
                if length == 0 {
                    break;
                }
                if chunk[..length].windows(4).any(|bytes| bytes == b"\x1b[6n") {
                    writer
                        .write_all(b"\x1b[1;1R")
                        .expect("the terminal query response should be writable");
                    writer
                        .flush()
                        .expect("the terminal query response should flush");
                }
                output.extend_from_slice(&chunk[..length]);
                if output.windows(15).any(|bytes| bytes == b"CHARTERM_PTY_OK") {
                    break;
                }
            }
            let _ = sender.send(output);
        });
        let output = receiver
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("the shell should produce output promptly");
        let output = String::from_utf8_lossy(&output);
        assert!(
            output.contains("CHARTERM_PTY_OK"),
            "unexpected PTY output: {output:?}"
        );
        let _ = child.kill();
    }
}
