mod credentials;
mod local_terminal;
mod network_scanner;
mod serial_terminal;
mod telnet_terminal;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(local_terminal::LocalTerminalManager::default())
        .manage(serial_terminal::SerialTerminalManager::default())
        .manage(telnet_terminal::TelnetTerminalManager::default())
        .manage(network_scanner::NetworkScanManager::default())
        .invoke_handler(tauri::generate_handler![
            local_terminal::create_local_terminal,
            local_terminal::create_ssh_terminal,
            local_terminal::create_sftp_terminal,
            local_terminal::write_local_terminal,
            local_terminal::resize_local_terminal,
            local_terminal::close_local_terminal,
            serial_terminal::list_serial_ports,
            serial_terminal::create_serial_terminal,
            serial_terminal::write_serial_terminal,
            serial_terminal::close_serial_terminal,
            telnet_terminal::create_telnet_terminal,
            telnet_terminal::write_telnet_terminal,
            telnet_terminal::close_telnet_terminal,
            credentials::save_connection_password,
            credentials::delete_connection_password,
            network_scanner::get_scanner_status,
            network_scanner::start_network_scan,
            network_scanner::cancel_network_scan,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CharTerm");
}
