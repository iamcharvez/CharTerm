use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs},
    process::{Child, Command, Stdio},
    str::FromStr,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn configure_background_command(command: &mut Command) {
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    #[cfg(not(target_os = "windows"))]
    let _ = command;
}

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
    mac_address: Option<String>,
    vendor: Option<String>,
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
    Host {
        host: ScanHost,
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
    let mut command = Command::new("nmap");
    command.arg("--version");
    configure_background_command(&mut command);
    let output = command.output().ok()?;
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

fn split_target_entries(value: &str) -> Vec<&str> {
    value
        .split(|character: char| character == ',' || character == ';' || character.is_whitespace())
        .filter(|value| !value.trim().is_empty())
        .collect()
}

fn normalize_ipv4_cidr(value: &str) -> Result<Option<String>, String> {
    let Some((address, prefix)) = value.split_once('/') else {
        return Ok(None);
    };
    if address.contains(':') {
        return Err(
            "IPv6 CIDR ranges are not supported yet. Enter a single IPv6 address instead.".into(),
        );
    }
    let address =
        Ipv4Addr::from_str(address).map_err(|_| format!("Invalid IPv4 CIDR address: {value}."))?;
    let prefix = prefix
        .parse::<u8>()
        .map_err(|_| format!("Invalid CIDR prefix in {value}. Use /0 through /32."))?;
    if prefix > 32 {
        return Err(format!(
            "Invalid CIDR prefix in {value}. IPv4 prefixes must be /0 through /32."
        ));
    }
    let host_bits = 32 - prefix;
    let mask = u32::MAX.checked_shl(host_bits.into()).unwrap_or(0);
    let network = Ipv4Addr::from(u32::from(address) & mask);
    Ok(Some(format!("{network}/{prefix}")))
}

fn parse_ipv4_range(value: &str) -> Result<Option<(Ipv4Addr, Ipv4Addr)>, String> {
    let Some((start, end)) = value.split_once('-') else {
        return Ok(None);
    };
    let Ok(start) = Ipv4Addr::from_str(start) else {
        return Ok(None);
    };
    let end = if end.contains('.') {
        Ipv4Addr::from_str(end)
            .map_err(|_| format!("Invalid ending IPv4 address in range {value}."))?
    } else {
        let last_octet = end.parse::<u8>().map_err(|_| {
            format!("Invalid final octet in range {value}. Use a value from 0 to 255.")
        })?;
        let octets = start.octets();
        Ipv4Addr::new(octets[0], octets[1], octets[2], last_octet)
    };
    if u32::from(start) > u32::from(end) {
        return Err(format!(
            "Range {value} is reversed. The ending address must be greater than or equal to the starting address."
        ));
    }
    let count = u64::from(u32::from(end)) - u64::from(u32::from(start)) + 1;
    if count > 4096 {
        return Err(format!(
            "Range {value} contains {count} addresses. A single range is limited to 4,096 addresses."
        ));
    }
    Ok(Some((start, end)))
}

fn normalize_target(value: &str) -> Result<String, String> {
    let value = validate_target(value)?;
    if let Some(cidr) = normalize_ipv4_cidr(&value)? {
        return Ok(cidr);
    }
    if let Some((start, end)) = parse_ipv4_range(&value)? {
        return Ok(format!("{start}-{end}"));
    }
    Ok(value)
}

fn parse_targets(value: &str) -> Result<Vec<String>, String> {
    let mut targets = Vec::new();
    let compact_ranges = value
        .replace(" - ", "-")
        .replace("- ", "-")
        .replace(" -", "-");
    for value in split_target_entries(&compact_ranges) {
        let target = normalize_target(value)?;
        if !targets.contains(&target) {
            targets.push(target);
        }
    }
    if targets.is_empty() {
        return Err("Enter at least one IP address, hostname, or IPv4 CIDR range.".into());
    }
    if targets.len() > 32 {
        return Err("A single scan can include up to 32 target entries.".into());
    }
    Ok(targets)
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
    if let Some((start, end)) = parse_ipv4_range(target)? {
        return Ok((u32::from(start)..=u32::from(end))
            .map(|address| IpAddr::V4(Ipv4Addr::from(address)))
            .collect());
    }
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

fn ipv4_range_to_cidrs(start: Ipv4Addr, end: Ipv4Addr) -> Vec<String> {
    let mut current = u32::from(start) as u64;
    let end = u32::from(end) as u64;
    let mut cidrs = Vec::new();
    while current <= end {
        let alignment_bits = if current == 0 {
            32
        } else {
            (current as u32).trailing_zeros()
        };
        let remaining = end - current + 1;
        let remaining_bits = 63 - remaining.leading_zeros();
        let host_bits = alignment_bits.min(remaining_bits).min(32);
        cidrs.push(format!(
            "{}/{}",
            Ipv4Addr::from(current as u32),
            32 - host_bits
        ));
        current += 1_u64 << host_bits;
    }
    cidrs
}

fn normalize_mac(value: &str) -> Option<String> {
    let compact: String = value
        .chars()
        .filter(|character| character.is_ascii_hexdigit())
        .collect();
    if compact.len() != 12
        || !value
            .chars()
            .any(|character| character == ':' || character == '-')
    {
        return None;
    }
    Some(
        compact
            .as_bytes()
            .chunks(2)
            .map(|chunk| String::from_utf8_lossy(chunk).to_ascii_uppercase())
            .collect::<Vec<_>>()
            .join(":"),
    )
}

fn is_discoverable_mac(mac: &str) -> bool {
    let compact = mac.replace(':', "");
    let Some(first_octet) = compact
        .get(0..2)
        .and_then(|value| u8::from_str_radix(value, 16).ok())
    else {
        return false;
    };
    compact != "000000000000" && compact != "FFFFFFFFFFFF" && first_octet & 0x01 == 0
}

fn parse_neighbor_table(output: &str, macs: &mut HashMap<IpAddr, String>) {
    for line in output.lines() {
        let columns: Vec<&str> = line.split_whitespace().collect();
        let Some(address) = columns
            .iter()
            .find_map(|value| value.parse::<IpAddr>().ok())
        else {
            continue;
        };
        if let Some(mac) = columns
            .iter()
            .find_map(|value| normalize_mac(value))
            .filter(|mac| is_discoverable_mac(mac))
        {
            macs.insert(address, mac);
        }
    }
}

fn probe_addresses(
    addresses: &[IpAddr],
    handle: &Arc<ScanHandle>,
    completed: &Arc<AtomicUsize>,
    total: usize,
    on_event: &Channel<ScanEvent>,
) -> HashSet<IpAddr> {
    let addresses: Vec<IpAddr> = addresses.to_vec();
    let jobs = Arc::new(addresses);
    let next = Arc::new(AtomicUsize::new(0));
    let responding = Arc::new(Mutex::new(HashSet::new()));
    let workers = jobs.len().min(32);
    thread::scope(|scope| {
        for _ in 0..workers {
            let jobs = Arc::clone(&jobs);
            let next = Arc::clone(&next);
            let responding = Arc::clone(&responding);
            let completed = Arc::clone(completed);
            let handle = Arc::clone(handle);
            let on_event = on_event.clone();
            scope.spawn(move || loop {
                if handle.cancelled.load(Ordering::Relaxed) {
                    break;
                }
                let index = next.fetch_add(1, Ordering::Relaxed);
                let Some(address) = jobs.get(index) else {
                    break;
                };
                #[cfg(target_os = "windows")]
                let status = {
                    let mut command = Command::new("ping");
                    command
                        .args(["-n", "1", "-w", "300", &address.to_string()])
                        .stdout(Stdio::null())
                        .stderr(Stdio::null());
                    configure_background_command(&mut command);
                    command.status()
                };
                #[cfg(not(target_os = "windows"))]
                let status = Command::new("ping")
                    .args(["-c", "1", "-W", "1", &address.to_string()])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();

                if status.is_ok_and(|status| status.success()) {
                    if let Ok(mut found) = responding.lock() {
                        found.insert(*address);
                    }
                    let _ = on_event.send(ScanEvent::Host {
                        host: ScanHost {
                            address: address.to_string(),
                            hostname: None,
                            mac_address: None,
                            vendor: None,
                            ports: Vec::new(),
                        },
                    });
                }
                let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                if done == total || done % 8 == 0 {
                    let _ = on_event.send(ScanEvent::Progress {
                        completed: done,
                        total,
                    });
                }
            });
        }
    });
    let responding = responding
        .lock()
        .map(|found| found.clone())
        .unwrap_or_default();
    responding
}

fn collect_mac_addresses() -> HashMap<IpAddr, String> {
    let mut macs = HashMap::new();
    #[cfg(target_os = "windows")]
    {
        const NEIGHBOR_SCRIPT: &str = "$valid = @('Reachable','Delay','Probe','Permanent'); Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $valid -contains $_.State -and $_.LinkLayerAddress -ne '00-00-00-00-00-00' } | ForEach-Object { Write-Output ($_.IPAddress + '|' + $_.LinkLayerAddress) }; Get-NetIPConfiguration | ForEach-Object { $mac = $_.NetAdapter.MacAddress; $_.IPv4Address | ForEach-Object { Write-Output ($_.IPAddress + '|' + $mac) } }";
        let mut powershell = Command::new("powershell.exe");
        powershell.args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            NEIGHBOR_SCRIPT,
        ]);
        configure_background_command(&mut powershell);
        if let Ok(output) = powershell.output() {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                let Some((address, mac)) = line.trim().split_once('|') else {
                    continue;
                };
                if let (Ok(address), Some(mac)) = (address.parse::<IpAddr>(), normalize_mac(mac)) {
                    if !is_discoverable_mac(&mac) {
                        continue;
                    }
                    macs.insert(address, mac);
                }
            }
        }
        if macs.is_empty() {
            let mut arp = Command::new("arp");
            arp.arg("-a");
            configure_background_command(&mut arp);
            if let Ok(output) = arp.output() {
                parse_neighbor_table(&String::from_utf8_lossy(&output.stdout), &mut macs);
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(output) = Command::new("ip").args(["neigh", "show"]).output() {
            parse_neighbor_table(&String::from_utf8_lossy(&output.stdout), &mut macs);
        } else if let Ok(output) = Command::new("arp").arg("-an").output() {
            parse_neighbor_table(&String::from_utf8_lossy(&output.stdout), &mut macs);
        }
    }
    macs
}

fn resolve_hostnames(addresses: &[IpAddr]) -> HashMap<IpAddr, String> {
    let jobs = Arc::new(addresses.to_vec());
    let next = Arc::new(AtomicUsize::new(0));
    let names = Arc::new(Mutex::new(HashMap::new()));
    let workers = jobs.len().min(24);
    thread::scope(|scope| {
        for _ in 0..workers {
            let jobs = Arc::clone(&jobs);
            let next = Arc::clone(&next);
            let names = Arc::clone(&names);
            scope.spawn(move || loop {
                let index = next.fetch_add(1, Ordering::Relaxed);
                let Some(address) = jobs.get(index) else {
                    break;
                };
                let Ok(name) = dns_lookup::lookup_addr(address) else {
                    continue;
                };
                let name = name.trim().trim_end_matches('.');
                if name.is_empty() || name == address.to_string() {
                    continue;
                }
                if let Ok(mut found) = names.lock() {
                    found.insert(*address, name.to_string());
                }
            });
        }
    });
    names.lock().map(|names| names.clone()).unwrap_or_default()
}

fn vendor_for_mac(mac: &str) -> Option<String> {
    let first_octet = u8::from_str_radix(mac.get(0..2)?, 16).ok()?;
    if first_octet & 0x02 != 0 {
        return None;
    }
    oui_data::lookup(mac).map(|record| record.organization().to_string())
}

fn service_name(port: u16) -> &'static str {
    match port {
        20 | 21 => "ftp",
        22 => "ssh",
        23 => "telnet",
        25 | 465 | 587 => "smtp",
        53 => "dns",
        67 | 68 => "dhcp",
        80 | 81 | 3000 | 5000 | 7001 | 8000 | 8008 | 8080 | 8081 | 8888 | 9000 | 9090 => "http",
        110 | 995 => "pop3",
        123 => "ntp",
        135 => "msrpc",
        137..=139 | 445 => "smb",
        143 | 993 => "imap",
        161 | 162 => "snmp",
        389 | 636 => "ldap",
        443 | 8443 | 9443 => "https",
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
    let targets = parse_targets(&request.target)?;
    let mut unique_addresses = HashSet::new();
    for target in &targets {
        for address in target_addresses(target)? {
            unique_addresses.insert(address);
            if unique_addresses.len() > 4096 {
                return Err("Multi-target scans are limited to 4,096 unique addresses.".into());
            }
        }
    }
    let mut addresses: Vec<IpAddr> = unique_addresses.into_iter().collect();
    addresses.sort_unstable();
    let ports = parse_ports(&request.ports)?;
    if addresses.len().saturating_mul(ports.len()) > 2_000_000 {
        return Err(
            "This scan is too large. Reduce the number of subnets or selected ports.".into(),
        );
    }
    let jobs: Vec<(IpAddr, u16)> = if request.mode == "discovery" {
        Vec::new()
    } else {
        addresses
            .iter()
            .flat_map(|address| ports.iter().map(move |port| (*address, *port)))
            .collect()
    };
    let total = addresses.len() + jobs.len();
    let jobs = Arc::new(jobs);
    let next = Arc::new(AtomicUsize::new(0));
    let completed = Arc::new(AtomicUsize::new(0));
    let open = Arc::new(Mutex::new(HashMap::<IpAddr, Vec<u16>>::new()));
    let timeout = Duration::from_millis(request.timeout_ms.clamp(50, 10_000));
    let workers = request.concurrency.clamp(1, 512).min(jobs.len().max(1));

    // Discovery is independent from port scanning. A device with no selected TCP
    // port open is still a device and must remain visible in the results.
    let responding = probe_addresses(&addresses, &handle, &completed, total, &on_event);
    if handle.cancelled.load(Ordering::Relaxed) {
        return Err("__cancelled__".into());
    }
    let macs = collect_mac_addresses();
    let target_set: HashSet<IpAddr> = addresses.iter().copied().collect();
    let mut discovered: HashSet<IpAddr> = responding;
    discovered.extend(
        macs.keys()
            .copied()
            .filter(|address| target_set.contains(address)),
    );
    let initial_addresses: Vec<IpAddr> = discovered.iter().copied().collect();
    let initial_names = resolve_hostnames(&initial_addresses);
    for address in &initial_addresses {
        let mac_address = macs.get(address).cloned();
        let _ = on_event.send(ScanEvent::Host {
            host: ScanHost {
                address: address.to_string(),
                hostname: initial_names.get(address).cloned(),
                vendor: mac_address.as_deref().and_then(vendor_for_mac),
                mac_address,
                ports: Vec::new(),
            },
        });
    }

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
                    let host = open.lock().ok().map(|mut results| {
                        let found_ports = results.entry(address).or_default();
                        found_ports.push(port);
                        found_ports.sort_unstable();
                        found_ports.dedup();
                        ScanHost {
                            address: address.to_string(),
                            hostname: None,
                            mac_address: None,
                            vendor: None,
                            ports: found_ports
                                .iter()
                                .copied()
                                .map(|port| ScanPort {
                                    port,
                                    protocol: "tcp".into(),
                                    service: service_name(port).into(),
                                    product: None,
                                })
                                .collect(),
                        }
                    });
                    if let Some(host) = host {
                        let _ = on_event.send(ScanEvent::Host { host });
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
    let open = open
        .lock()
        .map_err(|_| "Unable to collect scan results.".to_string())?
        .clone();
    discovered.extend(open.keys().copied());
    let mut discovered_addresses: Vec<IpAddr> = discovered.into_iter().collect();
    discovered_addresses.sort_unstable();
    let mut names = initial_names;
    let unnamed_addresses: Vec<IpAddr> = discovered_addresses
        .iter()
        .copied()
        .filter(|address| !names.contains_key(address))
        .collect();
    names.extend(resolve_hostnames(&unnamed_addresses));
    let hosts: Vec<ScanHost> = discovered_addresses
        .iter()
        .map(|address| {
            let mut ports = open.get(address).cloned().unwrap_or_default();
            ports.sort_unstable();
            let mac_address = macs.get(address).cloned();
            ScanHost {
                address: address.to_string(),
                hostname: names.get(address).cloned(),
                vendor: mac_address.as_deref().and_then(vendor_for_mac),
                mac_address,
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
                        mac_address: None,
                        vendor: None,
                        ports: Vec::new(),
                    })
                }
                b"address" => {
                    if let Some(current) = host.as_mut() {
                        match attr_value(&event, b"addrtype").as_deref() {
                            Some("ipv4") | Some("ipv6") if current.address.is_empty() => {
                                current.address = attr_value(&event, b"addr").unwrap_or_default();
                            }
                            Some("mac") => {
                                current.mac_address = attr_value(&event, b"addr");
                                current.vendor = attr_value(&event, b"vendor");
                            }
                            _ => {}
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
                    if let Some(current) = host.as_mut() {
                        match attr_value(&event, b"addrtype").as_deref() {
                            Some("ipv4") | Some("ipv6") if current.address.is_empty() => {
                                current.address = attr_value(&event, b"addr").unwrap_or_default();
                            }
                            Some("mac") => {
                                current.mac_address = attr_value(&event, b"addr");
                                current.vendor = attr_value(&event, b"vendor");
                            }
                            _ => {}
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

fn run_nmap_scan(
    request: &ScanRequest,
    handle: Arc<ScanHandle>,
    on_event: Channel<ScanEvent>,
) -> Result<Vec<ScanHost>, String> {
    let targets = parse_targets(&request.target)?;
    let mut nmap_targets = Vec::new();
    for target in targets {
        if let Some((start, end)) = parse_ipv4_range(&target)? {
            nmap_targets.extend(ipv4_range_to_cidrs(start, end));
        } else {
            nmap_targets.push(target);
        }
    }
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
        .args(&nmap_targets)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    configure_background_command(&mut command);
    let child = command
        .spawn()
        .map_err(|error| format!("Unable to start Nmap: {error}"))?;
    *handle
        .child
        .lock()
        .map_err(|_| "Unable to manage the Nmap process.")? = Some(child);
    let mut last_preview = Instant::now() - Duration::from_secs(1);
    let mut emitted_hosts = HashMap::<String, (usize, Option<String>)>::new();
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
        if last_preview.elapsed() >= Duration::from_millis(600) {
            if let Ok(xml) = fs::read_to_string(&output_path) {
                if let Ok(hosts) = parse_nmap_xml(&xml) {
                    for host in hosts {
                        let signature = (host.ports.len(), host.mac_address.clone());
                        if emitted_hosts.get(&host.address) != Some(&signature) {
                            emitted_hosts.insert(host.address.clone(), signature);
                            let _ = on_event.send(ScanEvent::Host { host });
                        }
                    }
                }
            }
            last_preview = Instant::now();
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
    parse_targets(&request.target)?;
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
            run_nmap_scan(&request, Arc::clone(&handle), on_event.clone())
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
        assert_eq!(
            parse_targets("192.168.1.0/24\n10.0.0.0/24,192.168.1.0/24").unwrap(),
            vec!["192.168.1.0/24", "10.0.0.0/24"]
        );
        assert_eq!(
            parse_targets("192.168.0.1/24, 192.168.1.1 - 254").unwrap(),
            vec!["192.168.0.0/24", "192.168.1.1-192.168.1.254"]
        );
        assert_eq!(target_addresses("192.168.1.1-254").unwrap().len(), 254);
        assert_eq!(
            target_addresses("192.168.2.1-192.168.10.254")
                .unwrap()
                .len(),
            2302
        );
        assert!(target_addresses("192.168.1.254-1").is_err());
        assert_eq!(
            ipv4_range_to_cidrs(
                "192.168.1.1".parse().unwrap(),
                "192.168.1.254".parse().unwrap()
            )
            .first()
            .map(String::as_str),
            Some("192.168.1.1/32")
        );
        assert_eq!(
            normalize_mac("aa-bb-cc-dd-ee-ff").as_deref(),
            Some("AA:BB:CC:DD:EE:FF")
        );
        assert!(vendor_for_mac("98:EE:CB:9B:62:7C").is_some());
        assert!(vendor_for_mac("D6:7E:C3:02:00:02").is_none());
        assert!(!is_discoverable_mac("FF:FF:FF:FF:FF:FF"));
        assert!(is_discoverable_mac("D6:7E:C3:02:00:02"));
        let mut macs = HashMap::new();
        parse_neighbor_table("10.0.254.3  e0-63-da-85-00-48  dynamic", &mut macs);
        assert_eq!(
            macs.get(&"10.0.254.3".parse().unwrap()).map(String::as_str),
            Some("E0:63:DA:85:00:48")
        );
    }

    #[test]
    fn parses_nmap_host_and_service_xml() {
        let xml = r#"<nmaprun><host><address addr="10.0.0.1" addrtype="ipv4"/><address addr="AA:BB:CC:DD:EE:FF" addrtype="mac" vendor="Example Networks"/><hostnames><hostname name="router"/></hostnames><ports><port protocol="tcp" portid="22"><state state="open"/><service name="ssh" product="OpenSSH"/></port></ports></host></nmaprun>"#;
        let hosts = parse_nmap_xml(xml).unwrap();
        assert_eq!(hosts[0].address, "10.0.0.1");
        assert_eq!(hosts[0].mac_address.as_deref(), Some("AA:BB:CC:DD:EE:FF"));
        assert_eq!(hosts[0].vendor.as_deref(), Some("Example Networks"));
        assert_eq!(hosts[0].ports[0].service, "ssh");
    }
}
