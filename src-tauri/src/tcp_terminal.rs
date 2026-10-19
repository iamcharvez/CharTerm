use crate::local_terminal::TerminalEvent;
use crate::terminal_transfer::{TransferEndpoint, TransferRoute};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{Shutdown, TcpStream, ToSocketAddrs},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{ipc::Channel, State};

struct TcpTerminalSession {
    writer: Mutex<TcpStream>,
    stopped: Arc<AtomicBool>,
    transfer_route: Arc<TransferRoute>,
}

#[derive(Default)]
pub struct TcpTerminalManager {
    sessions: Arc<Mutex<HashMap<String, Arc<TcpTerminalSession>>>>,
}

fn lock_error() -> String {
    "The TCP session is unavailable because its state lock was poisoned.".into()
}

#[tauri::command]
pub fn create_tcp_terminal(
    session_id: String,
    host: String,
    port: u16,
    connection_timeout: u16,
    on_event: Channel<TerminalEvent>,
    manager: State<'_, TcpTerminalManager>,
) -> Result<(), String> {
    let host = host.trim();
    if session_id.trim().is_empty() || host.is_empty() || host.starts_with('-') || port == 0 {
        return Err("Enter a valid host and TCP port.".into());
    }

    let mut sessions = manager.sessions.lock().map_err(|_| lock_error())?;
    if sessions.contains_key(&session_id) {
        return Err("A TCP session with this identifier is already running.".into());
    }

    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("Unable to resolve {host}: {error}"))?;
    let timeout = Duration::from_secs(u64::from(connection_timeout.clamp(1, 120)));
    let mut last_error = None;
    let mut connected = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, timeout) {
            Ok(stream) => {
                connected = Some(stream);
                break;
            }
            Err(error) => last_error = Some(error),
        }
    }
    let stream = connected.ok_or_else(|| {
        format!(
            "Unable to connect to {host}:{port}: {}",
            last_error
                .map(|error| error.to_string())
                .unwrap_or_else(|| "no network address was available".into())
        )
    })?;
    stream
        .set_read_timeout(Some(Duration::from_millis(100)))
        .map_err(|error| format!("Unable to configure the TCP connection: {error}"))?;
    let mut reader = stream
        .try_clone()
        .map_err(|error| format!("Unable to read the TCP connection: {error}"))?;
    let stopped = Arc::new(AtomicBool::new(false));
    let session = Arc::new(TcpTerminalSession {
        writer: Mutex::new(stream),
        stopped: Arc::clone(&stopped),
        transfer_route: Arc::new(TransferRoute::default()),
    });
    let reader_transfer_route = Arc::clone(&session.transfer_route);
    sessions.insert(session_id.clone(), session);
    drop(sessions);

    let session_map = Arc::clone(&manager.sessions);
    thread::spawn(move || {
        let mut buffer = [0_u8; 16 * 1024];
        while !stopped.load(Ordering::Relaxed) {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    if reader_transfer_route.capture(&buffer[..length]) {
                        continue;
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
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                    ) => {}
                Err(error) => {
                    let _ = on_event.send(TerminalEvent::Error {
                        message: format!("TCP input stopped: {error}"),
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

impl TcpTerminalManager {
    pub(crate) fn transfer_endpoint(&self, session_id: &str) -> Result<TransferEndpoint, String> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| lock_error())?
            .get(session_id)
            .cloned()
            .ok_or_else(|| "The TCP session is no longer running.".to_string())?;
        let route = Arc::clone(&session.transfer_route);
        Ok(TransferEndpoint::new(route, move |bytes| {
            let mut writer = session.writer.lock().map_err(|_| lock_error())?;
            writer
                .write_all(bytes)
                .and_then(|_| writer.flush())
                .map_err(|error| format!("Unable to write transfer data to TCP: {error}"))
        }))
    }
}

#[tauri::command]
pub fn write_tcp_terminal(
    session_id: String,
    data: String,
    manager: State<'_, TcpTerminalManager>,
) -> Result<(), String> {
    let session = manager
        .sessions
        .lock()
        .map_err(|_| lock_error())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "The TCP session is no longer running.".to_string())?;
    let mut writer = session.writer.lock().map_err(|_| lock_error())?;
    writer
        .write_all(data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|error| format!("Unable to write to the TCP connection: {error}"))
}

#[tauri::command]
pub fn close_tcp_terminal(
    session_id: String,
    manager: State<'_, TcpTerminalManager>,
) -> Result<(), String> {
    if let Some(session) = manager
        .sessions
        .lock()
        .map_err(|_| lock_error())?
        .remove(&session_id)
    {
        session.stopped.store(true, Ordering::Relaxed);
        let _ = session
            .writer
            .lock()
            .map_err(|_| lock_error())?
            .shutdown(Shutdown::Both);
    }
    Ok(())
}
