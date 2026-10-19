use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, State};

const DATABASE_VERSION: i64 = 2;
const MAX_STATE_BYTES: usize = 16 * 1024 * 1024;
const MAX_LOG_MESSAGE_BYTES: usize = 1_000;
const MAX_LOG_DETAILS_BYTES: usize = 4_000;

pub struct AppDatabase {
    connection: Mutex<Connection>,
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHost {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String,
    pub public_key: String,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub name: String,
    pub snapshot_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogEntry {
    pub id: i64,
    pub created_at: i64,
    pub level: String,
    pub category: String,
    pub message: String,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogSettings {
    pub retention_days: u32,
    pub max_entries: u32,
    pub max_size_mb: u32,
    pub minimum_level: String,
}

impl Default for ActivityLogSettings {
    fn default() -> Self {
        Self {
            retention_days: 14,
            max_entries: 10_000,
            max_size_mb: 10,
            minimum_level: "info".into(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogPage {
    entries: Vec<ActivityLogEntry>,
    total_count: u64,
    approximate_bytes: u64,
}

impl AppDatabase {
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let directory = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Could not resolve application data directory: {error}"))?;
        fs::create_dir_all(&directory)
            .map_err(|error| format!("Could not create application data directory: {error}"))?;
        let path = directory.join("charterm.sqlite3");
        let connection = Connection::open(&path)
            .map_err(|error| format!("Could not open CharTerm database: {error}"))?;
        connection
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = NORMAL;
                 PRAGMA foreign_keys = ON;
                 CREATE TABLE IF NOT EXISTS metadata (
                   key TEXT PRIMARY KEY NOT NULL,
                   value TEXT NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS application_state (
                   id INTEGER PRIMARY KEY CHECK (id = 1),
                   state_json TEXT NOT NULL,
                   updated_at INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS known_hosts (
                   host TEXT NOT NULL,
                   port INTEGER NOT NULL,
                   key_type TEXT NOT NULL,
                   fingerprint TEXT NOT NULL,
                   public_key TEXT NOT NULL,
                   first_seen_at INTEGER NOT NULL,
                   last_seen_at INTEGER NOT NULL,
                   PRIMARY KEY (host, port, key_type)
                 );
                 CREATE TABLE IF NOT EXISTS workspaces (
                   id TEXT PRIMARY KEY NOT NULL,
                   name TEXT NOT NULL,
                   snapshot_json TEXT NOT NULL,
                   created_at INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS transfer_jobs (
                   id TEXT PRIMARY KEY NOT NULL,
                   direction TEXT NOT NULL,
                   source_path TEXT NOT NULL,
                   destination_path TEXT NOT NULL,
                   state TEXT NOT NULL,
                   bytes_total INTEGER,
                   bytes_transferred INTEGER NOT NULL DEFAULT 0,
                   error TEXT,
                   created_at INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS activity_logs (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   created_at INTEGER NOT NULL,
                   level TEXT NOT NULL,
                   category TEXT NOT NULL,
                   message TEXT NOT NULL,
                   details TEXT
                 );
                 CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx
                   ON activity_logs(created_at DESC);
                 CREATE INDEX IF NOT EXISTS activity_logs_category_level_idx
                   ON activity_logs(category, level);",
            )
            .map_err(|error| format!("Could not initialize CharTerm database: {error}"))?;
        connection
            .execute(
                "INSERT INTO metadata(key, value) VALUES('schema_version', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [DATABASE_VERSION.to_string()],
            )
            .map_err(|error| format!("Could not record database version: {error}"))?;
        Ok(Self {
            connection: Mutex::new(connection),
            path,
        })
    }

    fn connection(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.connection
            .lock()
            .map_err(|_| "CharTerm database lock was poisoned.".to_string())
    }

    pub(crate) fn find_known_host(
        &self,
        host: &str,
        port: u16,
        key_type: &str,
    ) -> Result<Option<KnownHost>, String> {
        self.connection()?
            .query_row(
                "SELECT host, port, key_type, fingerprint, public_key, first_seen_at, last_seen_at
                 FROM known_hosts WHERE host = ?1 AND port = ?2 AND key_type = ?3",
                params![host, port, key_type],
                |row| {
                    Ok(KnownHost {
                        host: row.get(0)?,
                        port: row.get(1)?,
                        key_type: row.get(2)?,
                        fingerprint: row.get(3)?,
                        public_key: row.get(4)?,
                        first_seen_at: row.get(5)?,
                        last_seen_at: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("Could not check the trusted host key: {error}"))
    }

    pub(crate) fn record_activity(
        &self,
        level: &str,
        category: &str,
        message: &str,
        details: Option<&str>,
    ) -> Result<(), String> {
        let settings = self.log_settings()?;
        if !should_record_level(level, &settings.minimum_level) {
            return Ok(());
        }
        validate_log_field("category", category, 64)?;
        validate_log_field("message", message, MAX_LOG_MESSAGE_BYTES)?;
        if let Some(details) = details {
            validate_log_field("details", details, MAX_LOG_DETAILS_BYTES)?;
        }
        let created_at = unix_timestamp_millis()?;
        self.connection()?
            .execute(
                "INSERT INTO activity_logs(created_at, level, category, message, details)
                 VALUES(?1, ?2, ?3, ?4, ?5)",
                params![
                    created_at,
                    normalize_level(level)?,
                    category,
                    message,
                    details
                ],
            )
            .map_err(|error| format!("Could not record activity: {error}"))?;
        self.prune_activity_logs(&settings)
    }

    fn log_settings(&self) -> Result<ActivityLogSettings, String> {
        let value: Option<String> = self
            .connection()?
            .query_row(
                "SELECT value FROM metadata WHERE key = 'activity_log_settings'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Could not load log settings: {error}"))?;
        Ok(value
            .and_then(|value| serde_json::from_str(&value).ok())
            .map(normalize_log_settings)
            .unwrap_or_default())
    }

    fn prune_activity_logs(&self, settings: &ActivityLogSettings) -> Result<(), String> {
        let cutoff =
            unix_timestamp_millis()? - i64::from(settings.retention_days) * 24 * 60 * 60 * 1_000;
        let connection = self.connection()?;
        connection
            .execute("DELETE FROM activity_logs WHERE created_at < ?1", [cutoff])
            .map_err(|error| format!("Could not prune expired logs: {error}"))?;
        connection
            .execute(
                "DELETE FROM activity_logs WHERE id IN (
                   SELECT id FROM activity_logs ORDER BY created_at DESC, id DESC
                   LIMIT -1 OFFSET ?1
                 )",
                [settings.max_entries],
            )
            .map_err(|error| format!("Could not enforce the log entry limit: {error}"))?;

        let max_bytes = u64::from(settings.max_size_mb) * 1024 * 1024;
        loop {
            let bytes = activity_log_size(&connection)?;
            if bytes <= max_bytes {
                break;
            }
            let removed = connection
                .execute(
                    "DELETE FROM activity_logs WHERE id IN (
                       SELECT id FROM activity_logs ORDER BY created_at ASC, id ASC LIMIT 250
                     )",
                    [],
                )
                .map_err(|error| format!("Could not enforce the log storage limit: {error}"))?;
            if removed == 0 {
                break;
            }
        }
        Ok(())
    }
}

fn unix_timestamp_millis() -> Result<i64, String> {
    Ok(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("System clock error: {error}"))?
        .as_millis() as i64)
}

fn normalize_level(level: &str) -> Result<&str, String> {
    match level.to_ascii_lowercase().as_str() {
        "debug" => Ok("debug"),
        "info" => Ok("info"),
        "warn" => Ok("warn"),
        "error" => Ok("error"),
        _ => Err("Log level must be debug, info, warn, or error.".into()),
    }
}

fn level_priority(level: &str) -> u8 {
    match level {
        "debug" => 0,
        "info" => 1,
        "warn" => 2,
        "error" => 3,
        "off" => 4,
        _ => 1,
    }
}

fn should_record_level(level: &str, minimum: &str) -> bool {
    level_priority(level) >= level_priority(minimum) && minimum != "off"
}

fn normalize_log_settings(mut settings: ActivityLogSettings) -> ActivityLogSettings {
    settings.retention_days = settings.retention_days.clamp(1, 365);
    settings.max_entries = settings.max_entries.clamp(100, 100_000);
    settings.max_size_mb = settings.max_size_mb.clamp(1, 500);
    if !matches!(
        settings.minimum_level.as_str(),
        "debug" | "info" | "warn" | "error" | "off"
    ) {
        settings.minimum_level = "info".into();
    }
    settings
}

fn validate_log_field(name: &str, value: &str, max_bytes: usize) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > max_bytes || value.contains('\0') {
        return Err(format!("The log {name} is empty or too large."));
    }
    Ok(())
}

fn activity_log_size(connection: &Connection) -> Result<u64, String> {
    connection
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(level) + LENGTH(category) + LENGTH(message) +
             LENGTH(COALESCE(details, '')) + 32), 0) FROM activity_logs",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value.max(0) as u64)
        .map_err(|error| format!("Could not calculate log storage usage: {error}"))
}

fn validate_json(json: &str) -> Result<(), String> {
    if json.len() > MAX_STATE_BYTES {
        return Err("Application state is too large to save.".to_string());
    }
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|error| format!("Application state is not valid JSON: {error}"))?;
    if !value.is_object() {
        return Err("Application state must be a JSON object.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn load_application_state(database: State<'_, AppDatabase>) -> Result<Option<String>, String> {
    database
        .connection()?
        .query_row(
            "SELECT state_json FROM application_state WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not load application state: {error}"))
}

#[tauri::command]
pub fn save_application_state(
    database: State<'_, AppDatabase>,
    state_json: String,
) -> Result<(), String> {
    validate_json(&state_json)?;
    let updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("System clock error: {error}"))?
        .as_millis() as i64;
    database
        .connection()?
        .execute(
            "INSERT INTO application_state(id, state_json, updated_at) VALUES(1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
            params![state_json, updated_at],
        )
        .map_err(|error| format!("Could not save application state: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_database_path(database: State<'_, AppDatabase>) -> String {
    database.path.to_string_lossy().into_owned()
}

#[tauri::command]
pub fn record_activity_log(
    level: String,
    category: String,
    message: String,
    details: Option<String>,
    database: State<'_, AppDatabase>,
) -> Result<(), String> {
    database.record_activity(&level, &category, &message, details.as_deref())
}

#[tauri::command]
pub fn get_activity_log_settings(
    database: State<'_, AppDatabase>,
) -> Result<ActivityLogSettings, String> {
    database.log_settings()
}

#[tauri::command]
pub fn update_activity_log_settings(
    settings: ActivityLogSettings,
    database: State<'_, AppDatabase>,
) -> Result<ActivityLogSettings, String> {
    let settings = normalize_log_settings(settings);
    let value = serde_json::to_string(&settings)
        .map_err(|error| format!("Could not encode log settings: {error}"))?;
    database
        .connection()?
        .execute(
            "INSERT INTO metadata(key, value) VALUES('activity_log_settings', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [value],
        )
        .map_err(|error| format!("Could not save log settings: {error}"))?;
    database.prune_activity_logs(&settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn list_activity_logs(
    query: Option<String>,
    level: Option<String>,
    category: Option<String>,
    limit: Option<u32>,
    database: State<'_, AppDatabase>,
) -> Result<ActivityLogPage, String> {
    let query = query.unwrap_or_default();
    let level = level.unwrap_or_default();
    let category = category.unwrap_or_default();
    let limit = limit.unwrap_or(500).clamp(1, 100_000);
    let connection = database.connection()?;
    let total_count = connection
        .query_row("SELECT COUNT(*) FROM activity_logs", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|error| format!("Could not count activity logs: {error}"))?
        .max(0) as u64;
    let approximate_bytes = activity_log_size(&connection)?;
    let mut statement = connection
        .prepare(
            "SELECT id, created_at, level, category, message, details
             FROM activity_logs
             WHERE (?1 = '' OR level = ?1)
               AND (?2 = '' OR category = ?2)
               AND (?3 = '' OR LOWER(category || ' ' || message || ' ' || COALESCE(details, '')) LIKE '%' || LOWER(?3) || '%')
             ORDER BY created_at DESC, id DESC LIMIT ?4",
        )
        .map_err(|error| format!("Could not prepare the activity log query: {error}"))?;
    let rows = statement
        .query_map(params![level, category, query, limit], |row| {
            Ok(ActivityLogEntry {
                id: row.get(0)?,
                created_at: row.get(1)?,
                level: row.get(2)?,
                category: row.get(3)?,
                message: row.get(4)?,
                details: row.get(5)?,
            })
        })
        .map_err(|error| format!("Could not query activity logs: {error}"))?;
    let entries = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read activity logs: {error}"))?;
    Ok(ActivityLogPage {
        entries,
        total_count,
        approximate_bytes,
    })
}

#[tauri::command]
pub fn clear_activity_logs(database: State<'_, AppDatabase>) -> Result<(), String> {
    database
        .connection()?
        .execute("DELETE FROM activity_logs", [])
        .map_err(|error| format!("Could not clear activity logs: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn list_known_hosts(database: State<'_, AppDatabase>) -> Result<Vec<KnownHost>, String> {
    let connection = database.connection()?;
    let mut statement = connection
        .prepare(
            "SELECT host, port, key_type, fingerprint, public_key, first_seen_at, last_seen_at
             FROM known_hosts ORDER BY host COLLATE NOCASE, port, key_type",
        )
        .map_err(|error| format!("Could not prepare known-host query: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(KnownHost {
                host: row.get(0)?,
                port: row.get(1)?,
                key_type: row.get(2)?,
                fingerprint: row.get(3)?,
                public_key: row.get(4)?,
                first_seen_at: row.get(5)?,
                last_seen_at: row.get(6)?,
            })
        })
        .map_err(|error| format!("Could not query known hosts: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read known hosts: {error}"))
}

#[tauri::command]
pub fn trust_known_host(database: State<'_, AppDatabase>, host: KnownHost) -> Result<(), String> {
    if host.host.trim().is_empty()
        || host.fingerprint.trim().is_empty()
        || host.public_key.trim().is_empty()
    {
        return Err("Host, fingerprint, and public key are required.".to_string());
    }
    database.connection()?.execute(
        "INSERT INTO known_hosts(host, port, key_type, fingerprint, public_key, first_seen_at, last_seen_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(host, port, key_type) DO UPDATE SET
           fingerprint = excluded.fingerprint,
           public_key = excluded.public_key,
           last_seen_at = excluded.last_seen_at",
        params![host.host, host.port, host.key_type, host.fingerprint, host.public_key, host.first_seen_at, host.last_seen_at],
    ).map_err(|error| format!("Could not trust host key: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn forget_known_host(
    database: State<'_, AppDatabase>,
    host: String,
    port: u16,
    key_type: String,
) -> Result<(), String> {
    database
        .connection()?
        .execute(
            "DELETE FROM known_hosts WHERE host = ?1 AND port = ?2 AND key_type = ?3",
            params![host, port, key_type],
        )
        .map_err(|error| format!("Could not remove known host: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn save_workspace(
    database: State<'_, AppDatabase>,
    workspace: WorkspaceRecord,
) -> Result<(), String> {
    validate_json(&workspace.snapshot_json)?;
    database.connection()?.execute(
        "INSERT INTO workspaces(id, name, snapshot_json, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at",
        params![workspace.id, workspace.name, workspace.snapshot_json, workspace.created_at, workspace.updated_at],
    ).map_err(|error| format!("Could not save workspace: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn list_workspaces(database: State<'_, AppDatabase>) -> Result<Vec<WorkspaceRecord>, String> {
    let connection = database.connection()?;
    let mut statement = connection.prepare(
        "SELECT id, name, snapshot_json, created_at, updated_at FROM workspaces ORDER BY updated_at DESC",
    ).map_err(|error| format!("Could not prepare workspace query: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(WorkspaceRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                snapshot_json: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|error| format!("Could not query workspaces: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read workspaces: {error}"))
}

#[tauri::command]
pub fn delete_workspace(database: State<'_, AppDatabase>, id: String) -> Result<(), String> {
    database
        .connection()?
        .execute("DELETE FROM workspaces WHERE id = ?1", [id])
        .map_err(|error| format!("Could not delete workspace: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_object_state() {
        assert!(validate_json("[]").is_err());
        assert!(validate_json("{\"profiles\":[]}").is_ok());
    }

    #[test]
    fn normalizes_log_retention_and_filters_levels() {
        let settings = normalize_log_settings(ActivityLogSettings {
            retention_days: 0,
            max_entries: 2,
            max_size_mb: 900,
            minimum_level: "unexpected".into(),
        });
        assert_eq!(settings.retention_days, 1);
        assert_eq!(settings.max_entries, 100);
        assert_eq!(settings.max_size_mb, 500);
        assert_eq!(settings.minimum_level, "info");
        assert!(!should_record_level("debug", "info"));
        assert!(should_record_level("error", "warn"));
        assert!(!should_record_level("error", "off"));
    }
}
