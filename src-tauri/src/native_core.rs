use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::State;

const MAX_RUNTIME_RECORDS: usize = 200;

#[derive(Clone, Default)]
pub struct NativeConnectionCore {
    connections: Arc<Mutex<HashMap<String, ConnectionSnapshot>>>,
    jobs: Arc<Mutex<HashMap<String, BackgroundJobSnapshot>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSnapshot {
    id: String,
    protocol: String,
    label: String,
    state: String,
    error: Option<String>,
    updated_at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundJobSnapshot {
    id: String,
    kind: String,
    label: String,
    state: String,
    progress: Option<f64>,
    error: Option<String>,
    updated_at: i64,
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn clean(value: String, name: &str, max: usize) -> Result<String, String> {
    let value = value.trim().to_string();
    if value.is_empty() || value.len() > max || value.chars().any(char::is_control) {
        return Err(format!("Invalid {name}."));
    }
    Ok(value)
}

fn clean_error(error: Option<String>) -> Option<String> {
    error.map(|value| value.chars().take(500).collect())
}

fn trim_oldest<T>(records: &mut HashMap<String, T>, timestamp: impl Fn(&T) -> i64) {
    while records.len() > MAX_RUNTIME_RECORDS {
        if let Some(id) = records
            .iter()
            .min_by_key(|(_, value)| timestamp(value))
            .map(|(id, _)| id.clone())
        {
            records.remove(&id);
        } else {
            break;
        }
    }
}

#[tauri::command]
pub fn update_connection_runtime(
    core: State<'_, NativeConnectionCore>,
    id: String,
    protocol: String,
    label: String,
    state: String,
    error: Option<String>,
) -> Result<(), String> {
    let record = ConnectionSnapshot {
        id: clean(id, "connection identifier", 128)?,
        protocol: clean(protocol, "connection protocol", 32)?,
        label: clean(label, "connection label", 160)?,
        state: clean(state, "connection state", 32)?,
        error: clean_error(error),
        updated_at: now_millis(),
    };
    let mut connections = core
        .connections
        .lock()
        .map_err(|_| "Connection registry lock was poisoned.".to_string())?;
    connections.insert(record.id.clone(), record);
    trim_oldest(&mut connections, |item| item.updated_at);
    Ok(())
}

#[tauri::command]
pub fn remove_connection_runtime(
    core: State<'_, NativeConnectionCore>,
    id: String,
) -> Result<(), String> {
    core.connections
        .lock()
        .map_err(|_| "Connection registry lock was poisoned.".to_string())?
        .remove(&id);
    Ok(())
}

#[tauri::command]
pub fn list_connection_runtime(
    core: State<'_, NativeConnectionCore>,
) -> Result<Vec<ConnectionSnapshot>, String> {
    let mut records = core
        .connections
        .lock()
        .map_err(|_| "Connection registry lock was poisoned.".to_string())?
        .values()
        .cloned()
        .collect::<Vec<_>>();
    records.sort_by_key(|record| std::cmp::Reverse(record.updated_at));
    Ok(records)
}

#[tauri::command]
pub fn update_background_job(
    core: State<'_, NativeConnectionCore>,
    id: String,
    kind: String,
    label: String,
    state: String,
    progress: Option<f64>,
    error: Option<String>,
) -> Result<(), String> {
    let record = BackgroundJobSnapshot {
        id: clean(id, "job identifier", 128)?,
        kind: clean(kind, "job kind", 48)?,
        label: clean(label, "job label", 160)?,
        state: clean(state, "job state", 32)?,
        progress: progress.map(|value| value.clamp(0.0, 1.0)),
        error: clean_error(error),
        updated_at: now_millis(),
    };
    let mut jobs = core
        .jobs
        .lock()
        .map_err(|_| "Background job registry lock was poisoned.".to_string())?;
    jobs.insert(record.id.clone(), record);
    trim_oldest(&mut jobs, |item| item.updated_at);
    Ok(())
}

#[tauri::command]
pub fn list_background_jobs(
    core: State<'_, NativeConnectionCore>,
) -> Result<Vec<BackgroundJobSnapshot>, String> {
    let mut records = core
        .jobs
        .lock()
        .map_err(|_| "Background job registry lock was poisoned.".to_string())?
        .values()
        .cloned()
        .collect::<Vec<_>>();
    records.sort_by_key(|record| std::cmp::Reverse(record.updated_at));
    Ok(records)
}

#[tauri::command]
pub fn clear_finished_background_jobs(core: State<'_, NativeConnectionCore>) -> Result<(), String> {
    core.jobs
        .lock()
        .map_err(|_| "Background job registry lock was poisoned.".to_string())?
        .retain(|_, job| matches!(job.state.as_str(), "queued" | "running" | "cancelling"));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_truncates_runtime_fields() {
        assert!(clean(" ssh ".into(), "protocol", 8).is_ok());
        assert!(clean("bad\nvalue".into(), "protocol", 32).is_err());
        assert_eq!(clean_error(Some("x".repeat(900))).unwrap().len(), 500);
    }
}
