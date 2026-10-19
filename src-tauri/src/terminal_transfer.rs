use crate::{
    local_terminal::LocalTerminalManager, serial_terminal::SerialTerminalManager,
    tcp_terminal::TcpTerminalManager,
};
use kermit_proto::{Client as KermitClient, Command as KermitCommand, Config as KermitConfig};
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, SyncSender},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, State};
use zmodem2::{Action as ZAction, Event as ZEvent, FileInfo as ZFileInfo, Position};

const SOH: u8 = 0x01;
const STX: u8 = 0x02;
const EOT: u8 = 0x04;
const ACK: u8 = 0x06;
const NAK: u8 = 0x15;
const CAN: u8 = 0x18;
const CRC_REQUEST: u8 = b'C';

type ByteWriter = dyn Fn(&[u8]) -> Result<(), String> + Send + Sync;

/// A very small routing seam in the hot terminal read path. With no active
/// transfer it only takes a short mutex and immediately returns false.
#[derive(Default)]
pub(crate) struct TransferRoute {
    sink: Mutex<Option<SyncSender<Vec<u8>>>>,
}

impl TransferRoute {
    pub(crate) fn attach(&self) -> Result<Receiver<Vec<u8>>, String> {
        let mut sink = self
            .sink
            .lock()
            .map_err(|_| "The terminal transfer route is unavailable.".to_string())?;
        if sink.is_some() {
            return Err("Another transfer is already using this terminal.".into());
        }
        let (sender, receiver) = mpsc::sync_channel(128);
        *sink = Some(sender);
        Ok(receiver)
    }

    pub(crate) fn detach(&self) {
        if let Ok(mut sink) = self.sink.lock() {
            *sink = None;
        }
    }

    pub(crate) fn capture(&self, bytes: &[u8]) -> bool {
        let sender = self.sink.lock().ok().and_then(|sink| sink.clone());
        let Some(sender) = sender else { return false };
        if sender.send(bytes.to_vec()).is_ok() {
            true
        } else {
            self.detach();
            false
        }
    }
}

#[derive(Clone)]
pub(crate) struct TransferEndpoint {
    pub(crate) route: Arc<TransferRoute>,
    writer: Arc<ByteWriter>,
}

impl TransferEndpoint {
    pub(crate) fn new(
        route: Arc<TransferRoute>,
        writer: impl Fn(&[u8]) -> Result<(), String> + Send + Sync + 'static,
    ) -> Self {
        Self {
            route,
            writer: Arc::new(writer),
        }
    }

    fn write_all(&self, bytes: &[u8]) -> Result<(), String> {
        (self.writer)(bytes)
    }
}

struct ActiveTransfer {
    session_id: String,
    cancelled: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct TerminalTransferManager {
    active: Arc<Mutex<HashMap<String, ActiveTransfer>>>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum TransferEvent {
    Started {
        protocol: String,
        direction: String,
        file_name: String,
        total_bytes: Option<u64>,
    },
    File {
        file_name: String,
        total_bytes: Option<u64>,
    },
    Progress {
        transferred_bytes: u64,
        total_bytes: Option<u64>,
        bytes_per_second: u64,
        elapsed_ms: u64,
    },
    Completed {
        transferred_bytes: u64,
        elapsed_ms: u64,
    },
    Cancelled,
    Error {
        message: String,
    },
}

struct ProgressReporter<'a> {
    channel: &'a Channel<TransferEvent>,
    started: Instant,
    last_emit: Instant,
    last_bytes: u64,
    last_rate_time: Instant,
    rate: u64,
}

impl<'a> ProgressReporter<'a> {
    fn new(channel: &'a Channel<TransferEvent>) -> Self {
        let now = Instant::now();
        Self {
            channel,
            started: now,
            last_emit: now.checked_sub(Duration::from_secs(1)).unwrap_or(now),
            last_bytes: 0,
            last_rate_time: now,
            rate: 0,
        }
    }

    fn emit(&mut self, bytes: u64, total: Option<u64>, force: bool) {
        let now = Instant::now();
        let rate_elapsed = now.duration_since(self.last_rate_time);
        if rate_elapsed >= Duration::from_millis(400) {
            self.rate = ((bytes.saturating_sub(self.last_bytes)) as f64
                / rate_elapsed.as_secs_f64()) as u64;
            self.last_bytes = bytes;
            self.last_rate_time = now;
        }
        if force || now.duration_since(self.last_emit) >= Duration::from_millis(100) {
            let _ = self.channel.send(TransferEvent::Progress {
                transferred_bytes: bytes,
                total_bytes: total,
                bytes_per_second: self.rate,
                elapsed_ms: self.started.elapsed().as_millis() as u64,
            });
            self.last_emit = now;
        }
    }
}

struct TransferWire {
    endpoint: TransferEndpoint,
    receiver: Receiver<Vec<u8>>,
    buffered: VecDeque<u8>,
    cancelled: Arc<AtomicBool>,
}

impl TransferWire {
    fn new(
        endpoint: TransferEndpoint,
        receiver: Receiver<Vec<u8>>,
        cancelled: Arc<AtomicBool>,
    ) -> Self {
        Self {
            endpoint,
            receiver,
            buffered: VecDeque::new(),
            cancelled,
        }
    }

    fn ensure_running(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Relaxed) {
            Err("Transfer cancelled".into())
        } else {
            Ok(())
        }
    }

    fn write(&self, bytes: &[u8]) -> Result<(), String> {
        self.ensure_running()?;
        self.endpoint.write_all(bytes)
    }

    fn read_byte(&mut self, timeout: Duration) -> Result<Option<u8>, String> {
        if let Some(byte) = self.buffered.pop_front() {
            return Ok(Some(byte));
        }
        let deadline = Instant::now() + timeout;
        loop {
            self.ensure_running()?;
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Ok(None);
            }
            match self
                .receiver
                .recv_timeout(remaining.min(Duration::from_millis(100)))
            {
                Ok(bytes) => {
                    self.buffered.extend(bytes);
                    return Ok(self.buffered.pop_front());
                }
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("The terminal closed during the transfer.".into())
                }
            }
        }
    }

    fn read_exact(&mut self, length: usize, timeout: Duration) -> Result<Vec<u8>, String> {
        let deadline = Instant::now() + timeout;
        let mut result = Vec::with_capacity(length);
        while result.len() < length {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match self.read_byte(remaining)? {
                Some(byte) => result.push(byte),
                None => return Err("Timed out while receiving a protocol block.".into()),
            }
        }
        Ok(result)
    }

    fn read_chunk(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>, String> {
        self.ensure_running()?;
        if !self.buffered.is_empty() {
            return Ok(Some(self.buffered.drain(..).collect()));
        }
        match self.receiver.recv_timeout(timeout) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(RecvTimeoutError::Timeout) => Ok(None),
            Err(RecvTimeoutError::Disconnected) => {
                Err("The terminal closed during the transfer.".into())
            }
        }
    }
}

fn crc16_xmodem(bytes: &[u8]) -> u16 {
    let mut crc = 0_u16;
    for byte in bytes {
        crc ^= u16::from(*byte) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    crc
}

fn packet(block: u8, payload: &[u8], size: usize) -> Vec<u8> {
    let mut result = Vec::with_capacity(size + 5);
    result.push(if size == 128 { SOH } else { STX });
    result.push(block);
    result.push(255_u8.wrapping_sub(block));
    result.extend_from_slice(payload);
    result.resize(size + 3, 0x1a);
    let crc = crc16_xmodem(&result[3..]);
    result.extend_from_slice(&crc.to_be_bytes());
    result
}

fn receive_packet(wire: &mut TransferWire, marker: u8) -> Result<(u8, Vec<u8>), String> {
    let size = if marker == SOH { 128 } else { 1024 };
    let body = wire.read_exact(size + 4, Duration::from_secs(12))?;
    let block = body[0];
    if body[1] != 255_u8.wrapping_sub(block) {
        return Err("The received block number is invalid.".into());
    }
    let data = body[2..2 + size].to_vec();
    let received_crc = u16::from_be_bytes([body[size + 2], body[size + 3]]);
    if crc16_xmodem(&data) != received_crc {
        return Err("The received block failed its CRC check.".into());
    }
    Ok((block, data))
}

fn wait_for_receiver(wire: &mut TransferWire) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(60);
    while Instant::now() < deadline {
        match wire.read_byte(Duration::from_secs(1))? {
            Some(CRC_REQUEST | NAK) => return Ok(()),
            Some(CAN) => return Err("The remote receiver cancelled the transfer.".into()),
            _ => {}
        }
    }
    Err(
        "The remote receiver did not start the transfer. Start its receive command and try again."
            .into(),
    )
}

fn send_with_ack(wire: &mut TransferWire, bytes: &[u8]) -> Result<(), String> {
    for _ in 0..10 {
        wire.write(bytes)?;
        match wire.read_byte(Duration::from_secs(10))? {
            Some(ACK) => return Ok(()),
            Some(CAN) => return Err("The remote receiver cancelled the transfer.".into()),
            Some(NAK) | None => continue,
            _ => continue,
        }
    }
    Err("The remote side did not acknowledge the transfer block.".into())
}

fn finish_xmodem_send(wire: &mut TransferWire) -> Result<(), String> {
    for _ in 0..10 {
        wire.write(&[EOT])?;
        match wire.read_byte(Duration::from_secs(10))? {
            Some(ACK) => return Ok(()),
            Some(CAN) => return Err("The remote receiver cancelled the transfer.".into()),
            _ => {}
        }
    }
    Err("The remote side did not acknowledge the end of the transfer.".into())
}

fn run_xmodem_send(
    wire: &mut TransferWire,
    path: &Path,
    progress: &mut ProgressReporter<'_>,
) -> Result<u64, String> {
    let mut file = File::open(path).map_err(|error| format!("Unable to open the file: {error}"))?;
    let total = file.metadata().map_err(|error| error.to_string())?.len();
    wait_for_receiver(wire)?;
    let mut block = 1_u8;
    let mut transferred = 0_u64;
    loop {
        let mut data = vec![0_u8; 1024];
        let read = file
            .read(&mut data)
            .map_err(|error| format!("Unable to read the file: {error}"))?;
        if read == 0 {
            break;
        }
        data.truncate(read);
        let frame = packet(block, &data, 1024);
        send_with_ack(wire, &frame)?;
        transferred += read as u64;
        progress.emit(transferred, Some(total), false);
        block = block.wrapping_add(1);
    }
    finish_xmodem_send(wire)?;
    progress.emit(transferred, Some(total), true);
    Ok(transferred)
}

fn run_xmodem_receive(
    wire: &mut TransferWire,
    path: &Path,
    progress: &mut ProgressReporter<'_>,
) -> Result<u64, String> {
    let mut file =
        File::create(path).map_err(|error| format!("Unable to create the file: {error}"))?;
    let mut expected = 1_u8;
    let mut pending: Option<Vec<u8>> = None;
    let mut transferred = 0_u64;
    let mut retries = 0_u8;
    wire.write(&[CRC_REQUEST])?;
    loop {
        match wire.read_byte(Duration::from_secs(10))? {
            Some(marker @ (SOH | STX)) => match receive_packet(wire, marker) {
                Ok((block, data)) if block == expected => {
                    if let Some(previous) = pending.replace(data) {
                        file.write_all(&previous)
                            .map_err(|error| error.to_string())?;
                        transferred += previous.len() as u64;
                        progress.emit(transferred, None, false);
                    }
                    expected = expected.wrapping_add(1);
                    retries = 0;
                    wire.write(&[ACK])?;
                }
                Ok((block, _)) if block == expected.wrapping_sub(1) => wire.write(&[ACK])?,
                _ => {
                    retries += 1;
                    wire.write(&[NAK])?;
                }
            },
            Some(EOT) => {
                if let Some(mut last) = pending.take() {
                    while last.last() == Some(&0x1a) {
                        last.pop();
                    }
                    file.write_all(&last).map_err(|error| error.to_string())?;
                    transferred += last.len() as u64;
                }
                wire.write(&[ACK])?;
                file.flush().map_err(|error| error.to_string())?;
                progress.emit(transferred, None, true);
                return Ok(transferred);
            }
            Some(CAN) => return Err("The remote sender cancelled the transfer.".into()),
            _ => {
                retries += 1;
                wire.write(&[CRC_REQUEST])?;
            }
        }
        if retries >= 10 {
            return Err("Too many damaged blocks or timeouts during XMODEM receive.".into());
        }
    }
}

fn run_ymodem_send(
    wire: &mut TransferWire,
    path: &Path,
    progress: &mut ProgressReporter<'_>,
) -> Result<u64, String> {
    let mut file = File::open(path).map_err(|error| format!("Unable to open the file: {error}"))?;
    let total = file.metadata().map_err(|error| error.to_string())?.len();
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The file name is not valid Unicode.".to_string())?;
    wait_for_receiver(wire)?;
    let mut header = Vec::new();
    header.extend_from_slice(name.as_bytes());
    header.push(0);
    header.extend_from_slice(total.to_string().as_bytes());
    header.push(0);
    send_with_ack(wire, &packet(0, &header, 128))?;
    if wire.read_byte(Duration::from_secs(10))? != Some(CRC_REQUEST) {
        return Err("The remote YMODEM receiver did not request file data.".into());
    }
    let mut block = 1_u8;
    let mut transferred = 0_u64;
    loop {
        let mut data = vec![0_u8; 1024];
        let read = file.read(&mut data).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        data.truncate(read);
        send_with_ack(wire, &packet(block, &data, 1024))?;
        transferred += read as u64;
        progress.emit(transferred, Some(total), false);
        block = block.wrapping_add(1);
    }
    wire.write(&[EOT])?;
    if wire.read_byte(Duration::from_secs(10))? != Some(NAK) {
        return Err("The remote YMODEM receiver did not acknowledge the first end marker.".into());
    }
    wire.write(&[EOT])?;
    if wire.read_byte(Duration::from_secs(10))? != Some(ACK)
        || wire.read_byte(Duration::from_secs(10))? != Some(CRC_REQUEST)
    {
        return Err("The remote YMODEM receiver did not complete the file.".into());
    }
    send_with_ack(wire, &packet(0, &[], 128))?;
    progress.emit(transferred, Some(total), true);
    Ok(transferred)
}

fn run_ymodem_receive(
    wire: &mut TransferWire,
    path: &Path,
    progress: &mut ProgressReporter<'_>,
    on_event: &Channel<TransferEvent>,
) -> Result<u64, String> {
    wire.write(&[CRC_REQUEST])?;
    let marker = wire
        .read_byte(Duration::from_secs(10))?
        .ok_or_else(|| "Timed out waiting for the YMODEM file header.".to_string())?;
    if !matches!(marker, SOH | STX) {
        return Err("The remote sender did not provide a YMODEM file header.".into());
    }
    let (block, header) = receive_packet(wire, marker)?;
    if block != 0 {
        return Err("The YMODEM header used an invalid block number.".into());
    }
    let mut fields = header.split(|byte| *byte == 0);
    let remote_name = String::from_utf8_lossy(fields.next().unwrap_or_default()).to_string();
    let size_text = String::from_utf8_lossy(fields.next().unwrap_or_default());
    let total = size_text
        .split_ascii_whitespace()
        .next()
        .and_then(|value| value.parse::<u64>().ok());
    let _ = on_event.send(TransferEvent::File {
        file_name: remote_name,
        total_bytes: total,
    });
    let mut file =
        File::create(path).map_err(|error| format!("Unable to create the file: {error}"))?;
    wire.write(&[ACK, CRC_REQUEST])?;
    let mut expected = 1_u8;
    let mut transferred = 0_u64;
    let mut retries = 0_u8;
    loop {
        match wire.read_byte(Duration::from_secs(10))? {
            Some(marker @ (SOH | STX)) => match receive_packet(wire, marker) {
                Ok((block, data)) if block == expected => {
                    let remaining = total
                        .map(|size| size.saturating_sub(transferred) as usize)
                        .unwrap_or(data.len());
                    let length = remaining.min(data.len());
                    file.write_all(&data[..length])
                        .map_err(|error| error.to_string())?;
                    transferred += length as u64;
                    progress.emit(transferred, total, false);
                    expected = expected.wrapping_add(1);
                    retries = 0;
                    wire.write(&[ACK])?;
                }
                Ok((block, _)) if block == expected.wrapping_sub(1) => wire.write(&[ACK])?,
                _ => {
                    retries += 1;
                    wire.write(&[NAK])?;
                }
            },
            Some(EOT) => {
                wire.write(&[NAK])?;
                if wire.read_byte(Duration::from_secs(10))? != Some(EOT) {
                    return Err("The YMODEM end handshake was interrupted.".into());
                }
                wire.write(&[ACK, CRC_REQUEST])?;
                if let Some(marker @ (SOH | STX)) = wire.read_byte(Duration::from_secs(10))? {
                    let _ = receive_packet(wire, marker)?;
                    wire.write(&[ACK])?;
                }
                file.flush().map_err(|error| error.to_string())?;
                progress.emit(transferred, total, true);
                return Ok(transferred);
            }
            Some(CAN) => return Err("The remote sender cancelled the transfer.".into()),
            _ => {
                retries += 1;
                wire.write(&[NAK])?;
            }
        }
        if retries >= 10 {
            return Err("Too many damaged blocks or timeouts during YMODEM receive.".into());
        }
    }
}

fn run_zmodem_send(
    wire: &mut TransferWire,
    path: &Path,
    progress: &mut ProgressReporter<'_>,
) -> Result<u64, String> {
    let mut file = File::open(path).map_err(|error| format!("Unable to open the file: {error}"))?;
    let total = file.metadata().map_err(|error| error.to_string())?.len();
    let total32 = u32::try_from(total)
        .map_err(|_| "ZMODEM files are currently limited to 4 GiB.".to_string())?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "The file name is invalid.".to_string())?;
    let mut sender = zmodem2::Sender::new().map_err(|error| error.to_string())?;
    sender
        .start_file(ZFileInfo::new(
            name.as_bytes(),
            Some(Position::new(total32)),
        ))
        .map_err(|error| error.to_string())?;
    let mut transferred = 0_u64;
    let mut pending = Vec::new();
    let mut pending_offset = 0_usize;
    let mut last_input = Instant::now();
    loop {
        wire.ensure_running()?;
        match sender.poll() {
            ZAction::WriteWire(bytes) => {
                let length = bytes.len();
                wire.write(bytes)?;
                sender.wire_written(length);
            }
            ZAction::ReadFile { offset, max_len } => {
                file.seek(SeekFrom::Start(u64::from(offset.get())))
                    .map_err(|error| error.to_string())?;
                let mut buffer = vec![0_u8; max_len];
                let length = file.read(&mut buffer).map_err(|error| error.to_string())?;
                sender
                    .submit_file(&buffer[..length])
                    .map_err(|error| error.to_string())?;
                transferred = transferred.max(u64::from(offset.get()) + length as u64);
                progress.emit(transferred.min(total), Some(total), false);
            }
            ZAction::Event(ZEvent::FileCompleted) => {
                sender.finish().map_err(|error| error.to_string())?
            }
            ZAction::Event(ZEvent::SessionCompleted) => {
                progress.emit(total, Some(total), true);
                return Ok(total);
            }
            ZAction::Event(ZEvent::Aborted) => {
                return Err("The ZMODEM transfer was aborted.".into())
            }
            ZAction::Event(_) => {}
            ZAction::Idle => {
                if pending_offset < pending.len() {
                    let consumed = sender
                        .submit_wire(&pending[pending_offset..])
                        .map_err(|error| error.to_string())?;
                    pending_offset += consumed;
                    if pending_offset == pending.len() {
                        pending.clear();
                        pending_offset = 0;
                    }
                } else if let Some(bytes) = wire.read_chunk(Duration::from_millis(100))? {
                    pending = bytes;
                    pending_offset = 0;
                    last_input = Instant::now();
                } else if last_input.elapsed() >= Duration::from_secs(10) {
                    sender.timeout().map_err(|error| error.to_string())?;
                    last_input = Instant::now();
                }
            }
            ZAction::WriteFile(_) => return Err("Unexpected ZMODEM sender state.".into()),
            _ => {}
        }
    }
}

fn run_zmodem_receive(
    wire: &mut TransferWire,
    path: &Path,
    progress: &mut ProgressReporter<'_>,
    on_event: &Channel<TransferEvent>,
) -> Result<u64, String> {
    let mut file =
        File::create(path).map_err(|error| format!("Unable to create the file: {error}"))?;
    let mut receiver = zmodem2::Receiver::new().map_err(|error| error.to_string())?;
    let mut transferred = 0_u64;
    let mut total = None;
    let mut pending = Vec::new();
    let mut pending_offset = 0_usize;
    let mut last_input = Instant::now();
    loop {
        wire.ensure_running()?;
        match receiver.poll() {
            ZAction::WriteWire(bytes) => {
                let length = bytes.len();
                wire.write(bytes)?;
                receiver.wire_written(length);
            }
            ZAction::WriteFile(bytes) => {
                let length = bytes.len();
                file.write_all(bytes).map_err(|error| error.to_string())?;
                receiver
                    .file_written(length)
                    .map_err(|error| error.to_string())?;
                transferred += length as u64;
                progress.emit(transferred, total, false);
            }
            ZAction::Event(ZEvent::FileStarted(info)) => {
                total = info.size.map(|value| u64::from(value.get()));
                let _ = on_event.send(TransferEvent::File {
                    file_name: String::from_utf8_lossy(info.name).to_string(),
                    total_bytes: total,
                });
            }
            ZAction::Event(ZEvent::FileCompleted) => {
                file.flush().map_err(|error| error.to_string())?
            }
            ZAction::Event(ZEvent::SessionCompleted) => {
                progress.emit(transferred, total, true);
                return Ok(transferred);
            }
            ZAction::Event(ZEvent::Aborted) => {
                return Err("The ZMODEM transfer was aborted.".into())
            }
            ZAction::Event(_) => {}
            ZAction::Idle => {
                if pending_offset < pending.len() {
                    let consumed = receiver
                        .submit_wire(&pending[pending_offset..])
                        .map_err(|error| error.to_string())?;
                    pending_offset += consumed;
                    if pending_offset == pending.len() {
                        pending.clear();
                        pending_offset = 0;
                    }
                } else if let Some(bytes) = wire.read_chunk(Duration::from_millis(100))? {
                    pending = bytes;
                    pending_offset = 0;
                    last_input = Instant::now();
                } else if last_input.elapsed() >= Duration::from_secs(10) {
                    receiver.timeout().map_err(|error| error.to_string())?;
                    last_input = Instant::now();
                }
            }
            ZAction::ReadFile { .. } => return Err("Unexpected ZMODEM receiver state.".into()),
            _ => {}
        }
    }
}

fn run_kermit(
    wire: &mut TransferWire,
    direction: &str,
    path: &Path,
    remote_name: &str,
    progress: &mut ProgressReporter<'_>,
    on_event: &Channel<TransferEvent>,
) -> Result<u64, String> {
    let mut config = KermitConfig::default();
    config.max_size = None;
    let mut client = KermitClient::new(config);
    let mut output = if direction == "receive" {
        Some(File::create(path).map_err(|error| format!("Unable to create the file: {error}"))?)
    } else {
        None
    };
    let total = if direction == "send" {
        Some(fs::metadata(path).map_err(|error| error.to_string())?.len())
    } else {
        None
    };
    let command = if direction == "send" {
        let data = fs::read(path).map_err(|error| format!("Unable to read the file: {error}"))?;
        let name = if remote_name.trim().is_empty() {
            path.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("upload.bin")
        } else {
            remote_name.trim()
        };
        KermitCommand::Send(vec![kermit_proto::OutgoingFile {
            name: name.as_bytes().to_vec(),
            data,
        }])
    } else {
        if remote_name.trim().is_empty() {
            return Err("Enter the remote file name for a Kermit download.".into());
        }
        KermitCommand::Get(remote_name.trim().as_bytes().to_vec())
    };
    client
        .start(Instant::now(), command)
        .map_err(|error| error.to_string())?;
    let mut transferred = 0_u64;
    let mut done = false;
    loop {
        if wire.cancelled.load(Ordering::Relaxed) {
            client.cancel(Instant::now());
        }
        let now = Instant::now();
        while let Some(packet) = client.poll_output(now) {
            wire.endpoint.write_all(&packet)?;
        }
        while let Some(event) = client.poll_event() {
            match event {
                kermit_proto::Event::FileStart { name } => {
                    let _ = on_event.send(TransferEvent::File {
                        file_name: String::from_utf8_lossy(&name).to_string(),
                        total_bytes: total,
                    });
                }
                kermit_proto::Event::Data(data) => {
                    if let Some(file) = output.as_mut() {
                        file.write_all(&data).map_err(|error| error.to_string())?;
                    }
                    transferred += data.len() as u64;
                    progress.emit(transferred, total, false);
                }
                kermit_proto::Event::Progress {
                    sent,
                    total: event_total,
                } => {
                    transferred = sent;
                    progress.emit(sent, Some(event_total), false);
                }
                kermit_proto::Event::Error(error) => return Err(error.to_string()),
                kermit_proto::Event::Done => done = true,
                _ => {}
            }
        }
        if done && client.next_timeout().is_none() {
            if let Some(file) = output.as_mut() {
                file.flush().map_err(|error| error.to_string())?;
            }
            progress.emit(transferred, total, true);
            return Ok(transferred);
        }
        let wait = client
            .next_timeout()
            .map(|deadline| deadline.saturating_duration_since(Instant::now()))
            .unwrap_or(Duration::from_millis(100))
            .clamp(Duration::from_millis(10), Duration::from_millis(250));
        match wire.read_chunk(wait)? {
            Some(bytes) => client.handle_input(Instant::now(), &bytes),
            None => client.handle_timeout(Instant::now()),
        }
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("transfer")
        .to_string()
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn start_terminal_transfer(
    transfer_id: String,
    session_id: String,
    session_kind: String,
    protocol: String,
    direction: String,
    path: String,
    remote_name: Option<String>,
    remote_command: Option<String>,
    on_event: Channel<TransferEvent>,
    manager: State<'_, TerminalTransferManager>,
    local_manager: State<'_, LocalTerminalManager>,
    serial_manager: State<'_, SerialTerminalManager>,
    tcp_manager: State<'_, TcpTerminalManager>,
) -> Result<(), String> {
    let protocol = protocol.to_lowercase();
    let direction = direction.to_lowercase();
    if !matches!(protocol.as_str(), "zmodem" | "xmodem" | "ymodem" | "kermit") {
        return Err("Choose ZMODEM, XMODEM, YMODEM, or Kermit.".into());
    }
    if !matches!(direction.as_str(), "send" | "receive") {
        return Err("Choose whether to send or receive a file.".into());
    }
    if session_kind == "telnet" {
        return Err("Binary file transfer is disabled on Telnet because option negotiation can alter file bytes. Use SSH, Serial, or a raw TCP connection.".into());
    }
    if session_kind == "sftp" {
        return Err("Use the SFTP file manager for this session, or open an SSH terminal for modem protocols.".into());
    }
    let path = PathBuf::from(path);
    let remote_command = remote_command
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            if value.len() > 512 || value.contains(['\0', '\r', '\n']) {
                Err("The remote helper command must be one line and no longer than 512 characters.")
            } else {
                Ok(value)
            }
        })
        .transpose()?
        .unwrap_or_default();
    if direction == "send" && !path.is_file() {
        return Err("Choose a file that exists on this computer.".into());
    }
    if direction == "receive" && path.parent().is_none_or(|parent| !parent.is_dir()) {
        return Err("Choose a valid destination on this computer.".into());
    }
    let endpoint = match session_kind.as_str() {
        "serial" => serial_manager.transfer_endpoint(&session_id)?,
        "tcp" => tcp_manager.transfer_endpoint(&session_id)?,
        "local" | "ssh" => local_manager.transfer_endpoint(&session_id)?,
        _ => return Err("This terminal type does not support modem transfers.".into()),
    };
    let receiver = endpoint.route.attach()?;
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut active = manager
            .active
            .lock()
            .map_err(|_| "The transfer manager is unavailable.".to_string())?;
        if active.values().any(|item| item.session_id == session_id) {
            endpoint.route.detach();
            return Err("Another transfer is already active in this terminal.".into());
        }
        active.insert(
            transfer_id.clone(),
            ActiveTransfer {
                session_id,
                cancelled: Arc::clone(&cancelled),
            },
        );
    }
    let active = Arc::clone(&manager.active);
    let remote_name = remote_name.unwrap_or_default();
    thread::spawn(move || {
        let started = Instant::now();
        let total = if direction == "send" {
            fs::metadata(&path).ok().map(|metadata| metadata.len())
        } else {
            None
        };
        let _ = on_event.send(TransferEvent::Started {
            protocol: protocol.clone(),
            direction: direction.clone(),
            file_name: display_name(&path),
            total_bytes: total,
        });
        let mut wire = TransferWire::new(endpoint.clone(), receiver, Arc::clone(&cancelled));
        let mut progress = ProgressReporter::new(&on_event);
        if !remote_command.is_empty() {
            if let Err(message) =
                endpoint.write_all(format!("{}\r", remote_command.trim()).as_bytes())
            {
                endpoint.route.detach();
                if let Ok(mut active) = active.lock() {
                    active.remove(&transfer_id);
                }
                let _ = on_event.send(TransferEvent::Error { message });
                return;
            }
            thread::sleep(Duration::from_millis(350));
        }
        let result = match (protocol.as_str(), direction.as_str()) {
            ("xmodem", "send") => run_xmodem_send(&mut wire, &path, &mut progress),
            ("xmodem", "receive") => run_xmodem_receive(&mut wire, &path, &mut progress),
            ("ymodem", "send") => run_ymodem_send(&mut wire, &path, &mut progress),
            ("ymodem", "receive") => run_ymodem_receive(&mut wire, &path, &mut progress, &on_event),
            ("zmodem", "send") => run_zmodem_send(&mut wire, &path, &mut progress),
            ("zmodem", "receive") => run_zmodem_receive(&mut wire, &path, &mut progress, &on_event),
            ("kermit", _) => run_kermit(
                &mut wire,
                &direction,
                &path,
                &remote_name,
                &mut progress,
                &on_event,
            ),
            _ => Err("Unsupported transfer request.".into()),
        };
        endpoint.route.detach();
        if let Ok(mut active) = active.lock() {
            active.remove(&transfer_id);
        }
        if cancelled.load(Ordering::Relaxed) {
            let _ = endpoint.write_all(&[CAN, CAN, CAN, CAN, CAN]);
            let _ = on_event.send(TransferEvent::Cancelled);
        } else {
            match result {
                Ok(bytes) => {
                    let _ = on_event.send(TransferEvent::Completed {
                        transferred_bytes: bytes,
                        elapsed_ms: started.elapsed().as_millis() as u64,
                    });
                }
                Err(message) => {
                    let _ = on_event.send(TransferEvent::Error { message });
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_terminal_transfer(
    transfer_id: String,
    manager: State<'_, TerminalTransferManager>,
) -> Result<(), String> {
    let active = manager
        .active
        .lock()
        .map_err(|_| "The transfer manager is unavailable.".to_string())?;
    let transfer = active
        .get(&transfer_id)
        .ok_or_else(|| "The transfer is no longer active.".to_string())?;
    transfer.cancelled.store(true, Ordering::Relaxed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xmodem_crc_matches_standard_vector() {
        assert_eq!(crc16_xmodem(b"123456789"), 0x31c3);
    }

    #[test]
    fn packet_contains_block_complement_and_crc() {
        let frame = packet(7, b"hello", 128);
        assert_eq!(frame.len(), 133);
        assert_eq!(frame[0], SOH);
        assert_eq!(frame[1], 7);
        assert_eq!(frame[2], 248);
        assert_eq!(
            crc16_xmodem(&frame[3..131]),
            u16::from_be_bytes([frame[131], frame[132]])
        );
    }

    #[test]
    fn route_only_captures_while_attached() {
        let route = TransferRoute::default();
        assert!(!route.capture(b"terminal"));
        let receiver = route.attach().unwrap();
        assert!(route.capture(b"transfer"));
        assert_eq!(receiver.recv().unwrap(), b"transfer");
        route.detach();
        assert!(!route.capture(b"terminal"));
    }
}
