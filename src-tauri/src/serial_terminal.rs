use crate::local_terminal::TerminalEvent;
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{ipc::Channel, State};

struct SerialSession {
    writer: Mutex<Box<dyn serialport::SerialPort>>,
    stopped: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct SerialTerminalManager {
    sessions: Arc<Mutex<HashMap<String, Arc<SerialSession>>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortInfo {
    name: String,
    kind: String,
}

fn lock_error() -> String {
    "The serial session is unavailable because its state lock was poisoned.".into()
}

#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<SerialPortInfo>, String> {
    serialport::available_ports()
        .map_err(|error| format!("Unable to list serial ports: {error}"))
        .map(|ports| {
            ports
                .into_iter()
                .map(|port| SerialPortInfo {
                    name: port.port_name,
                    kind: match port.port_type {
                        serialport::SerialPortType::UsbPort(_) => "USB",
                        serialport::SerialPortType::BluetoothPort => "Bluetooth",
                        serialport::SerialPortType::PciPort => "PCI",
                        serialport::SerialPortType::Unknown => "Serial",
                    }
                    .into(),
                })
                .collect()
        })
}

#[tauri::command]
pub fn create_serial_terminal(
    session_id: String,
    port_name: String,
    baud_rate: u32,
    on_event: Channel<TerminalEvent>,
    manager: State<'_, SerialTerminalManager>,
) -> Result<(), String> {
    if session_id.trim().is_empty() || port_name.trim().is_empty() {
        return Err("Choose a valid serial port.".into());
    }
    if !(300..=4_000_000).contains(&baud_rate) {
        return Err("Choose a baud rate between 300 and 4,000,000.".into());
    }

    let mut sessions = manager.sessions.lock().map_err(|_| lock_error())?;
    if sessions.contains_key(&session_id) {
        return Err("A serial session with this identifier is already running.".into());
    }

    let port = serialport::new(port_name.trim(), baud_rate)
        .timeout(Duration::from_millis(100))
        .open()
        .map_err(|error| format!("Unable to open {}: {error}", port_name.trim()))?;
    let mut reader = port
        .try_clone()
        .map_err(|error| format!("Unable to read the serial port: {error}"))?;
    let stopped = Arc::new(AtomicBool::new(false));
    let session = Arc::new(SerialSession {
        writer: Mutex::new(port),
        stopped: Arc::clone(&stopped),
    });
    sessions.insert(session_id.clone(), session);
    drop(sessions);

    let session_map = Arc::clone(&manager.sessions);
    thread::spawn(move || {
        let mut buffer = vec![0_u8; 4096];
        while !stopped.load(Ordering::Relaxed) {
            match reader.read(&mut buffer) {
                Ok(0) => continue,
                Ok(length) => {
                    if on_event
                        .send(TerminalEvent::Output {
                            data: buffer[..length].to_vec(),
                        })
                        .is_err()
                    {
                        break;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::TimedOut => continue,
                Err(error) => {
                    let _ = on_event.send(TerminalEvent::Error {
                        message: format!("Serial input stopped: {error}"),
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
pub fn write_serial_terminal(
    session_id: String,
    data: String,
    manager: State<'_, SerialTerminalManager>,
) -> Result<(), String> {
    let session = manager
        .sessions
        .lock()
        .map_err(|_| lock_error())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "The serial session is no longer running.".to_string())?;
    let mut writer = session.writer.lock().map_err(|_| lock_error())?;
    writer
        .write_all(data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|error| format!("Unable to write to the serial port: {error}"))
}

#[tauri::command]
pub fn close_serial_terminal(
    session_id: String,
    manager: State<'_, SerialTerminalManager>,
) -> Result<(), String> {
    if let Some(session) = manager
        .sessions
        .lock()
        .map_err(|_| lock_error())?
        .remove(&session_id)
    {
        session.stopped.store(true, Ordering::Relaxed);
    }
    Ok(())
}
