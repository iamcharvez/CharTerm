mod app_database;
mod credentials;
mod identity_manager;
mod local_terminal;
mod native_core;
mod network_scanner;
mod serial_terminal;
mod sftp_manager;
mod tcp_terminal;
mod telnet_terminal;
mod terminal_transfer;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let database =
                app_database::AppDatabase::open(app.handle()).map_err(std::io::Error::other)?;
            app.manage(database);
            Ok(())
        })
        .manage(local_terminal::LocalTerminalManager::default())
        .manage(serial_terminal::SerialTerminalManager::default())
        .manage(sftp_manager::SftpManager::default())
        .manage(tcp_terminal::TcpTerminalManager::default())
        .manage(telnet_terminal::TelnetTerminalManager::default())
        .manage(terminal_transfer::TerminalTransferManager::default())
        .manage(network_scanner::NetworkScanManager::default())
        .manage(native_core::NativeConnectionCore::default())
        .invoke_handler(tauri::generate_handler![
            app_database::load_application_state,
            app_database::save_application_state,
            app_database::get_database_path,
            app_database::record_activity_log,
            app_database::get_activity_log_settings,
            app_database::update_activity_log_settings,
            app_database::list_activity_logs,
            app_database::clear_activity_logs,
            native_core::update_connection_runtime,
            native_core::remove_connection_runtime,
            native_core::list_connection_runtime,
            native_core::update_background_job,
            native_core::list_background_jobs,
            native_core::clear_finished_background_jobs,
            app_database::list_known_hosts,
            app_database::trust_known_host,
            app_database::forget_known_host,
            app_database::save_workspace,
            app_database::list_workspaces,
            app_database::delete_workspace,
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
            tcp_terminal::create_tcp_terminal,
            tcp_terminal::write_tcp_terminal,
            tcp_terminal::close_tcp_terminal,
            telnet_terminal::create_telnet_terminal,
            telnet_terminal::write_telnet_terminal,
            telnet_terminal::close_telnet_terminal,
            terminal_transfer::start_terminal_transfer,
            terminal_transfer::cancel_terminal_transfer,
            credentials::save_connection_password,
            credentials::delete_connection_password,
            credentials::save_identity_passphrase,
            credentials::delete_identity_passphrase,
            identity_manager::get_ssh_tool_status,
            identity_manager::generate_ssh_identity,
            identity_manager::change_identity_passphrase,
            identity_manager::inspect_ssh_identity,
            identity_manager::install_public_key,
            sftp_manager::connect_sftp,
            sftp_manager::close_sftp,
            sftp_manager::list_local_directory,
            sftp_manager::list_remote_directory,
            sftp_manager::sftp_upload,
            sftp_manager::sftp_upload_directory,
            sftp_manager::sftp_download,
            sftp_manager::sftp_download_directory,
            sftp_manager::cancel_sftp_transfer,
            sftp_manager::sftp_create_directory,
            sftp_manager::sftp_rename,
            sftp_manager::sftp_delete,
            network_scanner::get_scanner_status,
            network_scanner::start_network_scan,
            network_scanner::cancel_network_scan,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CharTerm");
}
