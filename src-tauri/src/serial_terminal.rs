use crate::local_terminal::TerminalEvent;
use crate::terminal_transfer::{TransferEndpoint, TransferRoute};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{ipc::Channel, State};

struct SerialSession {
    writer: Mutex<Box<dyn serialport::SerialPort>>,
    settings_tx: mpsc::Sender<SerialSettings>,
    stopped: Arc<AtomicBool>,
    transfer_route: Arc<TransferRoute>,
}

#[derive(Clone, Copy)]
struct SerialSettings {
    baud_rate: u32,
    data_bits: serialport::DataBits,
    stop_bits: serialport::StopBits,
    parity: serialport::Parity,
    flow_control: serialport::FlowControl,
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
    product: Option<String>,
    manufacturer: Option<String>,
    serial_number: Option<String>,
    vendor_id: Option<u16>,
    product_id: Option<u16>,
}

fn lock_error() -> String {
    "The serial session is unavailable because its state lock was poisoned.".into()
}

fn parse_serial_settings(
    baud_rate: u32,
    data_bits: u8,
    stop_bits: u8,
    parity: &str,
    flow_control: &str,
) -> Result<SerialSettings, String> {
    if !(50..=4_000_000).contains(&baud_rate) {
        return Err("Choose a baud rate between 50 and 4,000,000.".into());
    }
    let data_bits = match data_bits {
        5 => serialport::DataBits::Five,
        6 => serialport::DataBits::Six,
        7 => serialport::DataBits::Seven,
        8 => serialport::DataBits::Eight,
        _ => return Err("Serial data bits must be 5, 6, 7, or 8.".into()),
    };
    let stop_bits = match stop_bits {
        1 => serialport::StopBits::One,
        2 => serialport::StopBits::Two,
        _ => return Err("Serial stop bits must be 1 or 2.".into()),
    };
    let parity = match parity {
        "none" => serialport::Parity::None,
        "odd" => serialport::Parity::Odd,
        "even" => serialport::Parity::Even,
        _ => return Err("Serial parity must be none, odd, or even.".into()),
    };
    let flow_control = match flow_control {
        "none" => serialport::FlowControl::None,
        "hardware" => serialport::FlowControl::Hardware,
        "software" => serialport::FlowControl::Software,
        _ => return Err("Serial flow control must be none, hardware, or software.".into()),
    };
    Ok(SerialSettings {
        baud_rate,
        data_bits,
        stop_bits,
        parity,
        flow_control,
    })
}

fn apply_serial_settings(
    port: &mut dyn serialport::SerialPort,
    settings: SerialSettings,
) -> Result<(), String> {
    port.set_baud_rate(settings.baud_rate)
        .map_err(|error| format!("Unable to change the serial speed: {error}"))?;
    port.set_data_bits(settings.data_bits)
        .map_err(|error| format!("Unable to change serial data bits: {error}"))?;
    port.set_stop_bits(settings.stop_bits)
        .map_err(|error| format!("Unable to change serial stop bits: {error}"))?;
    port.set_parity(settings.parity)
        .map_err(|error| format!("Unable to change serial parity: {error}"))?;
    port.set_flow_control(settings.flow_control)
        .map_err(|error| format!("Unable to change serial flow control: {error}"))
}

#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<SerialPortInfo>, String> {
    serialport::available_ports()
        .map_err(|error| format!("Unable to list serial ports: {error}"))
        .map(|ports| {
            ports
                .into_iter()
                .map(|port| {
                    let (kind, product, manufacturer, serial_number, vendor_id, product_id) =
                        match port.port_type {
                            serialport::SerialPortType::UsbPort(info) => (
                                "USB",
                                info.product,
                                info.manufacturer,
                                info.serial_number,
                                Some(info.vid),
                                Some(info.pid),
                            ),
                            serialport::SerialPortType::BluetoothPort => {
                                ("Bluetooth", None, None, None, None, None)
                            }
                            serialport::SerialPortType::PciPort => {
                                ("PCI", None, None, None, None, None)
                            }
                            serialport::SerialPortType::Unknown => {
                                ("Serial", None, None, None, None, None)
                            }
                        };
                    SerialPortInfo {
                        name: port.port_name,
                        kind: kind.into(),
                        product,
                        manufacturer,
                        serial_number,
                        vendor_id,
                        product_id,
                    }
                })
                .collect()
        })
}

#[tauri::command]
pub fn create_serial_terminal(
    session_id: String,
    port_name: String,
    baud_rate: u32,
    data_bits: u8,
    stop_bits: u8,
    parity: String,
    flow_control: String,
    on_event: Channel<TerminalEvent>,
    manager: State<'_, SerialTerminalManager>,
) -> Result<(), String> {
    if session_id.trim().is_empty() || port_name.trim().is_empty() {
        return Err("Choose a valid serial port.".into());
    }
    let settings = parse_serial_settings(baud_rate, data_bits, stop_bits, &parity, &flow_control)?;

    let mut sessions = manager.sessions.lock().map_err(|_| lock_error())?;
    if sessions.contains_key(&session_id) {
        return Err("A serial session with this identifier is already running.".into());
    }

    let port = serialport::new(port_name.trim(), baud_rate)
        .data_bits(settings.data_bits)
        .stop_bits(settings.stop_bits)
        .parity(settings.parity)
        .flow_control(settings.flow_control)
        .timeout(Duration::from_millis(100))
        .open()
        .map_err(|error| format!("Unable to open {}: {error}", port_name.trim()))?;
    let mut reader = port
        .try_clone()
        .map_err(|error| format!("Unable to read the serial port: {error}"))?;
    let (settings_tx, settings_rx) = mpsc::channel::<SerialSettings>();
    let stopped = Arc::new(AtomicBool::new(false));
    let session = Arc::new(SerialSession {
        writer: Mutex::new(port),
        settings_tx,
        stopped: Arc::clone(&stopped),
        transfer_route: Arc::new(TransferRoute::default()),
    });
    let reader_transfer_route = Arc::clone(&session.transfer_route);
    sessions.insert(session_id.clone(), session);
    drop(sessions);

    let session_map = Arc::clone(&manager.sessions);
    thread::spawn(move || {
        let mut buffer = vec![0_u8; 4096];
        while !stopped.load(Ordering::Relaxed) {
            while let Ok(settings) = settings_rx.try_recv() {
                if let Err(message) = apply_serial_settings(reader.as_mut(), settings) {
                    let _ = on_event.send(TerminalEvent::Error { message });
                }
            }
            match reader.read(&mut buffer) {
                Ok(0) => continue,
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
pub fn reconfigure_serial_terminal(
    session_id: String,
    baud_rate: u32,
    data_bits: u8,
    stop_bits: u8,
    parity: String,
    flow_control: String,
    manager: State<'_, SerialTerminalManager>,
) -> Result<(), String> {
    let settings = parse_serial_settings(baud_rate, data_bits, stop_bits, &parity, &flow_control)?;
    let session = manager
        .sessions
        .lock()
        .map_err(|_| lock_error())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "The serial session is no longer running.".to_string())?;
    {
        let mut writer = session.writer.lock().map_err(|_| lock_error())?;
        apply_serial_settings(writer.as_mut(), settings)?;
    }
    session
        .settings_tx
        .send(settings)
        .map_err(|_| "The serial input reader is no longer running.".to_string())
}

impl SerialTerminalManager {
    pub(crate) fn transfer_endpoint(&self, session_id: &str) -> Result<TransferEndpoint, String> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| lock_error())?
            .get(session_id)
            .cloned()
            .ok_or_else(|| "The serial session is no longer running.".to_string())?;
        let route = Arc::clone(&session.transfer_route);
        Ok(TransferEndpoint::new(route, move |bytes| {
            let mut writer = session.writer.lock().map_err(|_| lock_error())?;
            writer
                .write_all(bytes)
                .and_then(|_| writer.flush())
                .map_err(|error| {
                    format!("Unable to write transfer data to the serial port: {error}")
                })
        }))
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_standard_and_custom_serial_speeds() {
        assert!(parse_serial_settings(9_600, 8, 1, "none", "none").is_ok());
        assert!(parse_serial_settings(115_200, 8, 1, "none", "none").is_ok());
        assert!(parse_serial_settings(74_880, 8, 1, "none", "none").is_ok());
        assert!(parse_serial_settings(49, 8, 1, "none", "none").is_err());
    }
}
