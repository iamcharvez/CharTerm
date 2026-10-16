use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs},
    process::{Child, Command, Stdio},
    str::FromStr,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{ipc::Channel, State};

#[derive(Default)]
pub struct NetworkScanManager {
    scans: Arc<Mutex<HashMap<String, Arc<ScanHandle>>>>,
}

struct ScanHandle {
    cancelled: AtomicBool,
    child: Mutex<Option<Child>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    scan_id: String,
    target: String,
    ports: String,
    engine: String,
    mode: String,
    timeout_ms: u64,
    concurrency: usize,
    service_detection: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanPort {
    port: u16,
    protocol: String,
    service: String,
    product: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanHost {
    address: String,
    hostname: Option<String>,
    ports: Vec<ScanPort>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum ScanEvent {
    Started {
        engine: String,
    },
    Progress {
        completed: usize,
        total: usize,
    },
    Complete {
        hosts: Vec<ScanHost>,
        engine: String,
    },
    Cancelled,
    Error {
        message: String,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannerStatus {
    nmap_available: bool,
    nmap_version: Option<String>,
}

fn nmap_version() -> Option<String> {
    let output = Command::new("nmap").arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(str::to_string)
}

#[tauri::command]
pub fn get_scanner_status() -> ScannerStatus {
    let version = nmap_version();
    ScannerStatus {
        nmap_available: version.is_some(),
        nmap_version: version,
    }
}

fn validate_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn validate_target(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 253
        || value.starts_with('-')
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ".-:/".contains(character))
    {
        return Err("Enter a valid IP address, hostname, or IPv4 CIDR range.".into());
    }
    Ok(value.to_string())
}

fn parse_ports(value: &str) -> Result<Vec<u16>, String> {
    let mut ports = Vec::new();
    for part in value
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        if let Some((start, end)) = part.split_once('-') {
            let start = start.parse::<u16>().map_err(|_| "Invalid port range.")?;
            let end = end.parse::<u16>().map_err(|_| "Invalid port range.")?;
            if start == 0 || end < start {
                return Err("Invalid port range.".into());
            }
            ports.extend(start..=end);
        } else {
            let port = part.parse::<u16>().map_err(|_| "Invalid port number.")?;
            if port == 0 {
                return Err("Ports must be between 1 and 65535.".into());
            }
            ports.push(port);
        }
        if ports.len() > 2048 {
            return Err("The built-in scanner supports up to 2,048 ports per scan.".into());
        }
    }
    ports.sort_unstable();
    ports.dedup();
    if ports.is_empty() {
        return Err("Choose at least one port.".into());
    }
    Ok(ports)
}

fn target_addresses(target: &str) -> Result<Vec<IpAddr>, String> {
    if let Some((address, prefix)) = target.split_once('/') {
        let ip = Ipv4Addr::from_str(address).map_err(|_| "Only IPv4 CIDR ranges are supported.")?;
        let prefix = prefix.parse::<u8>().map_err(|_| "Invalid CIDR prefix.")?;
        if !(22..=32).contains(&prefix) {
            return Err("Built-in subnet scans are limited to /22 or smaller ranges.".into());
        }
        let host_bits = 32 - prefix;
        let count = 1_u32 << host_bits;
        let mask = u32::MAX.checked_shl(host_bits.into()).unwrap_or(0);
        let network = u32::from(ip) & mask;
        return Ok((0..count)
            .map(|offset| IpAddr::V4(Ipv4Addr::from(network + offset)))
            .collect());
    }
    if let Ok(ip) = IpAddr::from_str(target) {
        return Ok(vec![ip]);
    }
    let addresses: Vec<IpAddr> = (target, 0)
        .to_socket_addrs()
        .map_err(|error| format!("Unable to resolve {target}: {error}"))?
        .map(|address| address.ip())
        .collect();
    if addresses.is_empty() {
        Err(format!("No address was found for {target}."))
    } else {
        Ok(addresses)
    }
}

fn service_name(port: u16) -> &'static str {
    match port {
        20 | 21 => "ftp",
        22 => "ssh",
        23 => "telnet",
        25 | 465 | 587 => "smtp",
        53 => "dns",
        67 | 68 => "dhcp",
        80 | 8080 | 8000 => "http",
        110 | 995 => "pop3",
        123 => "ntp",
        135 => "msrpc",
        137..=139 | 445 => "smb",
        143 | 993 => "imap",
        161 | 162 => "snmp",
        389 | 636 => "ldap",
        443 | 8443 => "https",
        1433 => "mssql",
        1521 => "oracle",
        3306 => "mysql",
        3389 => "rdp",
        5432 => "postgresql",
        5900 => "vnc",
        6379 => "redis",
        _ => "unknown",
    }
}

fn run_builtin_scan(
    request: ScanRequest,
    handle: Arc<ScanHandle>,
    on_event: Channel<ScanEvent>,
) -> Result<Vec<ScanHost>, String> {
    let target = validate_target(&request.target)?;
    let addresses = target_addresses(&target)?;
    let ports = parse_ports(&request.ports)?;
    let jobs: Vec<(IpAddr, u16)> = addresses
        .iter()
        .flat_map(|address| ports.iter().map(move |port| (*address, *port)))
        .collect();
    let total = jobs.len();
    let jobs = Arc::new(jobs);
    let next = Arc::new(AtomicUsize::new(0));
    let completed = Arc::new(AtomicUsize::new(0));
    let open = Arc::new(Mutex::new(HashMap::<IpAddr, Vec<u16>>::new()));
    let timeout = Duration::from_millis(request.timeout_ms.clamp(50, 5_000));
    let workers = request.concurrency.clamp(1, 256).min(total.max(1));

    thread::scope(|scope| {
        for _ in 0..workers {
            let jobs = Arc::clone(&jobs);
            let next = Arc::clone(&next);
            let completed = Arc::clone(&completed);
            let open = Arc::clone(&open);
            let handle = Arc::clone(&handle);
            let on_event = on_event.clone();
            scope.spawn(move || loop {
                if handle.cancelled.load(Ordering::Relaxed) {
                    break;
                }
                let index = next.fetch_add(1, Ordering::Relaxed);
                let Some((address, port)) = jobs.get(index).copied() else {
                    break;
                };
                if TcpStream::connect_timeout(&SocketAddr::new(address, port), timeout).is_ok() {
                    if let Ok(mut results) = open.lock() {
                        results.entry(address).or_default().push(port);
                    }
                }
                let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                if done == total || done % 25 == 0 {
                    let _ = on_event.send(ScanEvent::Progress {
                        completed: done,
                        total,
                    });
                }
            });
        }
    });

    if handle.cancelled.load(Ordering::Relaxed) {
        return Err("__cancelled__".into());
    }
    let mut hosts: Vec<ScanHost> = open
        .lock()
        .map_err(|_| "Unable to collect scan results.".to_string())?
        .iter()
        .map(|(address, ports)| {
            let mut ports = ports.clone();
            ports.sort_unstable();
            ScanHost {
                address: address.to_string(),
                hostname: None,
                ports: ports
                    .into_iter()
                    .map(|port| ScanPort {
                        port,
                        protocol: "tcp".into(),
                        service: service_name(port).into(),
                        product: None,
                    })
                    .collect(),
            }
        })
        .collect();
    hosts.sort_by(|a, b| a.address.cmp(&b.address));
    Ok(hosts)
}

fn attr_value(event: &quick_xml::events::BytesStart<'_>, name: &[u8]) -> Option<String> {
    event.attributes().flatten().find_map(|attribute| {
        (attribute.key.as_ref() == name)
            .then(|| String::from_utf8_lossy(attribute.value.as_ref()).to_string())
    })
}

fn parse_nmap_xml(xml: &str) -> Result<Vec<ScanHost>, String> {
    let mut reader = Reader::from_str(xml);
    let mut hosts = Vec::new();
    let mut host: Option<ScanHost> = None;
    let mut port: Option<ScanPort> = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => match event.name().as_ref() {
                b"host" => {
                    host = Some(ScanHost {
                        address: String::new(),
                        hostname: None,
                        ports: Vec::new(),
                    })
                }
                b"address" => {
                    if attr_value(&event, b"addrtype").as_deref() == Some("ipv4") {
                        if let Some(current) = host.as_mut() {
                            current.address = attr_value(&event, b"addr").unwrap_or_default();
                        }
                    }
                }
                b"hostname" => {
                    if let Some(current) = host.as_mut() {
                        current.hostname = attr_value(&event, b"name");
                    }
                }
                b"port" => {
                    port = Some(ScanPort {
                        port: attr_value(&event, b"portid")
                            .and_then(|value| value.parse().ok())
                            .unwrap_or(0),
                        protocol: attr_value(&event, b"protocol").unwrap_or_else(|| "tcp".into()),
                        service: "unknown".into(),
                        product: None,
                    })
                }
                b"service" => {
                    if let Some(current) = port.as_mut() {
                        current.service =
                            attr_value(&event, b"name").unwrap_or_else(|| "unknown".into());
                        current.product = attr_value(&event, b"product");
                    }
                }
                _ => {}
            },
            Ok(Event::Empty(event)) => match event.name().as_ref() {
                b"address" => {
                    if attr_value(&event, b"addrtype").as_deref() == Some("ipv4") {
                        if let Some(current) = host.as_mut() {
                            current.address = attr_value(&event, b"addr").unwrap_or_default();
                        }
                    }
                }
                b"hostname" => {
                    if let Some(current) = host.as_mut() {
                        current.hostname = attr_value(&event, b"name");
                    }
                }
                b"state" => {
                    if attr_value(&event, b"state").as_deref() != Some("open") {
                        port = None;
                    }
                }
                b"service" => {
                    if let Some(current) = port.as_mut() {
                        current.service =
                            attr_value(&event, b"name").unwrap_or_else(|| "unknown".into());
                        current.product = attr_value(&event, b"product");
                    }
                }
                _ => {}
            },
            Ok(Event::End(event)) if event.name().as_ref() == b"port" => {
                if let (Some(current), Some(found)) = (host.as_mut(), port.take()) {
                    if found.port > 0 {
                        current.ports.push(found);
                    }
                }
            }
            Ok(Event::End(event)) if event.name().as_ref() == b"host" => {
                if let Some(found) = host.take() {
                    if !found.address.is_empty() {
                        hosts.push(found);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(format!("Unable to parse Nmap results: {error}")),
            _ => {}
        }
    }
    Ok(hosts)
}

fn run_nmap_scan(request: &ScanRequest, handle: Arc<ScanHandle>) -> Result<Vec<ScanHost>, String> {
    let target = validate_target(&request.target)?;
    if request.ports.len() > 512
        || !request
            .ports
            .chars()
            .all(|character| character.is_ascii_digit() || ",-".contains(character))
    {
        return Err("The port selection is invalid.".into());
    }
    let output_path = std::env::temp_dir().join(format!("charterm-scan-{}.xml", request.scan_id));
    let mut command = Command::new("nmap");
    command.args(["-T4", "-oX"]).arg(&output_path);
    if request.mode == "discovery" {
        command.arg("-sn");
    } else {
        command.args(["-sT", "--open", "-p", &request.ports]);
        if request.service_detection {
            command.arg("-sV");
        }
    }
    command
        .arg(target)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = command
        .spawn()
        .map_err(|error| format!("Unable to start Nmap: {error}"))?;
    *handle
        .child
        .lock()
        .map_err(|_| "Unable to manage the Nmap process.")? = Some(child);
    loop {
        if handle.cancelled.load(Ordering::Relaxed) {
            return Err("__cancelled__".into());
        }
        let finished = handle
            .child
            .lock()
            .map_err(|_| "Unable to manage the Nmap process.")?
            .as_mut()
            .and_then(|child| child.try_wait().ok())
            .is_some();
        if finished {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    let xml = fs::read_to_string(&output_path)
        .map_err(|error| format!("Unable to read Nmap results: {error}"))?;
    let _ = fs::remove_file(output_path);
    parse_nmap_xml(&xml)
}

#[tauri::command]
pub fn start_network_scan(
    request: ScanRequest,
    on_event: Channel<ScanEvent>,
    manager: State<'_, NetworkScanManager>,
) -> Result<(), String> {
    if !validate_id(&request.scan_id) {
        return Err("Invalid scan identifier.".into());
    }
    validate_target(&request.target)?;
    let engine =
        if request.engine == "nmap" || (request.engine == "auto" && nmap_version().is_some()) {
            "nmap"
        } else {
            "built-in"
        };
    if request.engine == "nmap" && nmap_version().is_none() {
        return Err("Nmap is not installed or is not available in PATH. Choose Automatic or Built-in TCP instead.".into());
    }
    let handle = Arc::new(ScanHandle {
        cancelled: AtomicBool::new(false),
        child: Mutex::new(None),
    });
    manager
        .scans
        .lock()
        .map_err(|_| "Unable to start the scan.")?
        .insert(request.scan_id.clone(), Arc::clone(&handle));
    let scans = Arc::clone(&manager.scans);
    let scan_id = request.scan_id.clone();
    let engine_name = engine.to_string();
    let _ = on_event.send(ScanEvent::Started {
        engine: engine_name.clone(),
    });
    thread::spawn(move || {
        let result = if engine_name == "nmap" {
            run_nmap_scan(&request, Arc::clone(&handle))
        } else {
            run_builtin_scan(request, Arc::clone(&handle), on_event.clone())
        };
        match result {
            Ok(hosts) => {
                let _ = on_event.send(ScanEvent::Complete {
                    hosts,
                    engine: engine_name,
                });
            }
            Err(error) if error == "__cancelled__" => {
                let _ = on_event.send(ScanEvent::Cancelled);
            }
            Err(message) => {
                let _ = on_event.send(ScanEvent::Error { message });
            }
        }
        if let Ok(mut active) = scans.lock() {
            active.remove(&scan_id);
        }
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_network_scan(
    scan_id: String,
    manager: State<'_, NetworkScanManager>,
) -> Result<(), String> {
    if let Some(handle) = manager
        .scans
        .lock()
        .map_err(|_| "Unable to cancel the scan.")?
        .get(&scan_id)
        .cloned()
    {
        handle.cancelled.store(true, Ordering::Relaxed);
        if let Ok(mut child) = handle.child.lock() {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
            }
        }
    }
    let _ = fs::remove_file(std::env::temp_dir().join(format!("charterm-scan-{scan_id}.xml")));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ports_and_limits_large_scans() {
        assert_eq!(parse_ports("22,80,443").unwrap(), vec![22, 80, 443]);
        assert!(target_addresses("192.168.1.0/21").is_err());
        assert_eq!(target_addresses("192.168.1.0/24").unwrap().len(), 256);
    }

    #[test]
    fn parses_nmap_host_and_service_xml() {
        let xml = r#"<nmaprun><host><address addr="10.0.0.1" addrtype="ipv4"/><hostnames><hostname name="router"/></hostnames><ports><port protocol="tcp" portid="22"><state state="open"/><service name="ssh" product="OpenSSH"/></port></ports></host></nmaprun>"#;
        let hosts = parse_nmap_xml(xml).unwrap();
        assert_eq!(hosts[0].address, "10.0.0.1");
        assert_eq!(hosts[0].ports[0].service, "ssh");
    }
}
