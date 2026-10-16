use crate::local_terminal::TerminalEvent;
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

const IAC: u8 = 255;
const WILL: u8 = 251;
const WONT: u8 = 252;
const DO: u8 = 253;
const DONT: u8 = 254;
const SUPPRESS_GO_AHEAD: u8 = 3;
const ECHO: u8 = 1;

struct TelnetSession {
    writer: Mutex<TcpStream>,
    stopped: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct TelnetTerminalManager {
    sessions: Arc<Mutex<HashMap<String, Arc<TelnetSession>>>>,
}

fn lock_error() -> String {
    "The Telnet session is unavailable because its state lock was poisoned.".into()
}

fn decode_telnet(input: &[u8], replies: &mut Vec<u8>) -> Vec<u8> {
    let mut output = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        if input[index] != IAC {
            output.push(input[index]);
            index += 1;
            continue;
        }
        if index + 1 >= input.len() {
            break;
        }
        let command = input[index + 1];
        if command == IAC {
            output.push(IAC);
            index += 2;
            continue;
        }
        if matches!(command, WILL | WONT | DO | DONT) && index + 2 < input.len() {
            let option = input[index + 2];
            let response = match command {
                WILL if matches!(option, ECHO | SUPPRESS_GO_AHEAD) => DO,
                WILL => DONT,
                DO if option == SUPPRESS_GO_AHEAD => WILL,
                DO => WONT,
                _ => 0,
            };
            if response != 0 {
                replies.extend_from_slice(&[IAC, response, option]);
            }
            index += 3;
            continue;
        }
        index += 2;
    }
    output
}

#[tauri::command]
pub fn create_telnet_terminal(
    session_id: String,
    host: String,
    port: u16,
    connection_timeout: u16,
    on_event: Channel<TerminalEvent>,
    manager: State<'_, TelnetTerminalManager>,
) -> Result<(), String> {
    let host = host.trim();
    if session_id.trim().is_empty() || host.is_empty() || host.starts_with('-') || port == 0 {
        return Err("Enter a valid Telnet host and port.".into());
    }

    let mut sessions = manager.sessions.lock().map_err(|_| lock_error())?;
    if sessions.contains_key(&session_id) {
        return Err("A Telnet session with this identifier is already running.".into());
    }
    let address = (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("Unable to resolve {host}: {error}"))?
        .next()
        .ok_or_else(|| format!("No network address was found for {host}."))?;
    let stream = TcpStream::connect_timeout(
        &address,
        Duration::from_secs(u64::from(connection_timeout.clamp(1, 120))),
    )
    .map_err(|error| format!("Unable to connect to {host}:{port}: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_millis(100)))
        .map_err(|error| format!("Unable to configure the Telnet connection: {error}"))?;
    let mut reader = stream
        .try_clone()
        .map_err(|error| format!("Unable to read the Telnet connection: {error}"))?;
    let mut negotiation_writer = stream
        .try_clone()
        .map_err(|error| format!("Unable to negotiate the Telnet connection: {error}"))?;
    let stopped = Arc::new(AtomicBool::new(false));
    sessions.insert(
        session_id.clone(),
        Arc::new(TelnetSession {
            writer: Mutex::new(stream),
            stopped: Arc::clone(&stopped),
        }),
    );
    drop(sessions);

    let session_map = Arc::clone(&manager.sessions);
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        while !stopped.load(Ordering::Relaxed) {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    let mut replies = Vec::new();
                    let output = decode_telnet(&buffer[..length], &mut replies);
                    if !replies.is_empty() {
                        let _ = negotiation_writer.write_all(&replies);
                    }
                    if !output.is_empty()
                        && on_event
                            .send(TerminalEvent::Output { data: output })
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
                        message: format!("Telnet input stopped: {error}"),
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
pub fn write_telnet_terminal(
    session_id: String,
    data: String,
    manager: State<'_, TelnetTerminalManager>,
) -> Result<(), String> {
    let session = manager
        .sessions
        .lock()
        .map_err(|_| lock_error())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "The Telnet session is no longer running.".to_string())?;
    let mut writer = session.writer.lock().map_err(|_| lock_error())?;
    writer
        .write_all(data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|error| format!("Unable to write to the Telnet connection: {error}"))
}

#[tauri::command]
pub fn close_telnet_terminal(
    session_id: String,
    manager: State<'_, TelnetTerminalManager>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_telnet_negotiation_and_replies_safely() {
        let mut replies = Vec::new();
        let output = decode_telnet(&[b'H', b'i', IAC, WILL, ECHO, b'!'], &mut replies);
        assert_eq!(output, b"Hi!");
        assert_eq!(replies, vec![IAC, DO, ECHO]);
    }
}
