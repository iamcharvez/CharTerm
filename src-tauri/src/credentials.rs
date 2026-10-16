use keyring::Entry;

const SERVICE: &str = "com.charvez.charterm";

fn validate_id(profile_id: &str) -> Result<(), String> {
    if profile_id.is_empty()
        || profile_id.len() > 128
        || !profile_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("The credential profile identifier is invalid.".into());
    }
    Ok(())
}

fn entry(profile_id: &str) -> Result<Entry, String> {
    validate_id(profile_id)?;
    Entry::new(SERVICE, profile_id)
        .map_err(|error| format!("The operating system credential vault is unavailable: {error}"))
}

pub fn load_password(profile_id: &str) -> Result<String, String> {
    entry(profile_id)?
        .get_password()
        .map_err(|error| format!("Unable to read the saved password: {error}"))
}

#[tauri::command]
pub fn save_connection_password(profile_id: String, password: String) -> Result<(), String> {
    if password.is_empty() {
        return Err("Enter a password before saving it.".into());
    }
    entry(&profile_id)?
        .set_password(&password)
        .map_err(|error| format!("Unable to save the password securely: {error}"))
}

#[tauri::command]
pub fn delete_connection_password(profile_id: String) -> Result<(), String> {
    entry(&profile_id)?
        .delete_credential()
        .map_err(|error| format!("Unable to remove the saved password: {error}"))
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn windows_credential_vault_round_trip() {
        let profile_id = format!("vault-test-{}", std::process::id());
        let entry = entry(&profile_id).expect("Windows Credential Manager should be available");
        entry
            .set_password("temporary-test-secret")
            .expect("test credential should save");
        assert_eq!(
            entry.get_password().expect("test credential should load"),
            "temporary-test-secret"
        );
        entry
            .delete_credential()
            .expect("test credential should be removed");
    }
}
