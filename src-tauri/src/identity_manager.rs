use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use ssh2::{HashType, HostKeyType, KeyboardInteractivePrompt, Prompt, Session};
use ssh_key::{rand_core::OsRng, Algorithm, HashAlg, LineEnding, PrivateKey, PublicKey};
use std::{
    fs,
    net::{TcpStream, ToSocketAddrs},
    path::PathBuf,
    time::Duration,
};
use tauri::State;
use zeroize::Zeroize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshToolStatus {
    native_generator: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityInspection {
    private_key_path: String,
    public_key_path: Option<String>,
    public_key: Option<String>,
    fingerprint: String,
    algorithm: String,
}

struct PasswordPrompter(String);

impl KeyboardInteractivePrompt for PasswordPrompter {
    fn prompt<'a>(&mut self, _: &str, _: &str, prompts: &[Prompt<'a>]) -> Vec<String> {
        prompts
            .iter()
            .map(|prompt| {
                if prompt.echo {
                    String::new()
                } else {
                    self.0.clone()
                }
            })
            .collect()
    }
}

impl Drop for PasswordPrompter {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[tauri::command]
pub fn get_ssh_tool_status() -> SshToolStatus {
    SshToolStatus {
        native_generator: true,
    }
}

fn inspect(
    private_key_path: &str,
    public_key_path: Option<String>,
    passphrase: Option<&str>,
) -> Result<IdentityInspection, String> {
    let private = PathBuf::from(private_key_path);
    if !private.is_file() {
        return Err("The selected private key file does not exist.".into());
    }
    let public = public_key_path.map(PathBuf::from).or_else(|| {
        let candidate = PathBuf::from(format!("{}.pub", private.to_string_lossy()));
        candidate.is_file().then_some(candidate)
    });
    let private_key = PrivateKey::read_openssh_file(&private)
        .map_err(|error| format!("Unable to read this OpenSSH private key: {error}"))?;
    if private_key.is_encrypted() {
        if let Some(secret) = passphrase.filter(|value| !value.is_empty()) {
            private_key
                .decrypt(secret)
                .map_err(|_| "The private-key passphrase is incorrect.".to_string())?;
        }
    }
    let public_key = if let Some(path) = public.as_ref() {
        PublicKey::read_openssh_file(path)
            .map_err(|error| format!("Unable to read the OpenSSH public key: {error}"))?
    } else {
        private_key.public_key().clone()
    };
    let public_key_text = public_key
        .to_openssh()
        .map_err(|error| format!("Unable to encode the public key: {error}"))?;
    Ok(IdentityInspection {
        private_key_path: private.to_string_lossy().into_owned(),
        public_key_path: public
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned()),
        public_key: Some(public_key_text),
        fingerprint: public_key.fingerprint(HashAlg::Sha256).to_string(),
        algorithm: public_key.algorithm().as_str().to_string(),
    })
}

#[tauri::command]
pub async fn inspect_ssh_identity(
    private_key_path: String,
    public_key_path: Option<String>,
    mut passphrase: Option<String>,
) -> Result<IdentityInspection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = inspect(
            private_key_path.trim(),
            public_key_path.filter(|value| !value.trim().is_empty()),
            passphrase.as_deref(),
        );
        if let Some(secret) = passphrase.as_mut() {
            secret.zeroize();
        }
        result
    })
    .await
    .map_err(|error| format!("The SSH identity worker stopped unexpectedly: {error}"))?
}

fn generate_ssh_identity_blocking(
    private_key_path: String,
    algorithm: String,
    comment: String,
    mut passphrase: String,
) -> Result<IdentityInspection, String> {
    let result = (|| {
        let path = PathBuf::from(private_key_path.trim());
        let public_path = PathBuf::from(format!("{}.pub", path.to_string_lossy()));
        if path.as_os_str().is_empty() || path.exists() || public_path.exists() {
            return Err(
                "Choose a new file name. CharTerm will not overwrite an existing key.".into(),
            );
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Unable to create the key folder: {error}"))?;
        }
        let algorithm = if algorithm == "rsa" {
            Algorithm::Rsa { hash: None }
        } else {
            Algorithm::Ed25519
        };
        let mut private_key = PrivateKey::random(&mut OsRng, algorithm)
            .map_err(|error| format!("Unable to generate a secure SSH key: {error}"))?;
        private_key.set_comment(comment.trim());
        if !passphrase.is_empty() {
            private_key = private_key
                .encrypt(&mut OsRng, passphrase.as_bytes())
                .map_err(|error| format!("Unable to protect the private key: {error}"))?;
        }
        private_key
            .write_openssh_file(&path, LineEnding::LF)
            .map_err(|error| format!("Unable to save the private key: {error}"))?;
        private_key
            .public_key()
            .write_openssh_file(&public_path)
            .map_err(|error| format!("Unable to save the public key: {error}"))?;
        inspect(
            &path.to_string_lossy(),
            Some(public_path.to_string_lossy().into_owned()),
            None,
        )
    })();
    passphrase.zeroize();
    result
}

#[tauri::command]
pub async fn generate_ssh_identity(
    private_key_path: String,
    algorithm: String,
    comment: String,
    passphrase: String,
) -> Result<IdentityInspection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        generate_ssh_identity_blocking(private_key_path, algorithm, comment, passphrase)
    })
    .await
    .map_err(|error| format!("The SSH key generator stopped unexpectedly: {error}"))?
}

fn change_identity_passphrase_blocking(
    private_key_path: String,
    mut current_passphrase: String,
    mut new_passphrase: String,
) -> Result<(), String> {
    let result = (|| {
        let path = PathBuf::from(private_key_path.trim());
        if !path.is_file() {
            return Err("The private key file no longer exists.".into());
        }
        let key = PrivateKey::read_openssh_file(&path)
            .map_err(|error| format!("Unable to read this OpenSSH private key: {error}"))?;
        let decrypted = if key.is_encrypted() {
            key.decrypt(current_passphrase.as_bytes())
                .map_err(|_| "The current passphrase is incorrect.".to_string())?
        } else {
            key
        };
        let updated = if new_passphrase.is_empty() {
            decrypted
        } else {
            decrypted
                .encrypt(&mut OsRng, new_passphrase.as_bytes())
                .map_err(|error| format!("Unable to protect the private key: {error}"))?
        };
        let temporary = path.with_extension("charterm-new-key");
        let backup = path.with_extension("charterm-key-backup");
        updated
            .write_openssh_file(&temporary, LineEnding::LF)
            .map_err(|error| format!("Unable to write the updated key: {error}"))?;
        if backup.exists() {
            fs::remove_file(&backup).map_err(|error| error.to_string())?;
        }
        fs::rename(&path, &backup)
            .map_err(|error| format!("Unable to prepare the existing key: {error}"))?;
        if let Err(error) = fs::rename(&temporary, &path) {
            let _ = fs::rename(&backup, &path);
            let _ = fs::remove_file(&temporary);
            return Err(format!("Unable to replace the private key: {error}"));
        }
        fs::remove_file(&backup).map_err(|error| {
            format!("The key was updated, but its temporary backup could not be removed: {error}")
        })?;
        Ok(())
    })();
    current_passphrase.zeroize();
    new_passphrase.zeroize();
    result
}

#[tauri::command]
pub async fn change_identity_passphrase(
    private_key_path: String,
    current_passphrase: String,
    new_passphrase: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        change_identity_passphrase_blocking(private_key_path, current_passphrase, new_passphrase)
    })
    .await
    .map_err(|error| format!("The passphrase worker stopped unexpectedly: {error}"))?
}

fn fingerprint(session: &Session) -> Result<String, String> {
    let digest = session
        .host_key_hash(HashType::Sha256)
        .ok_or("The server did not provide a usable host key.")?;
    Ok(digest
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":"))
}

#[tauri::command]
pub fn install_public_key(
    host: String,
    port: u16,
    username: String,
    mut password: String,
    public_key: String,
    database: State<'_, crate::app_database::AppDatabase>,
) -> Result<(), String> {
    if host.trim().is_empty()
        || username.trim().is_empty()
        || public_key.trim().is_empty()
        || port == 0
    {
        return Err("Host, username, password, and public key are required.".into());
    }
    let address = (host.trim(), port)
        .to_socket_addrs()
        .map_err(|error| format!("Unable to resolve host: {error}"))?
        .next()
        .ok_or("No network address was available.")?;
    let socket = TcpStream::connect_timeout(&address, Duration::from_secs(15))
        .map_err(|error| format!("Unable to connect: {error}"))?;
    let mut session = Session::new().map_err(|error| error.to_string())?;
    session.set_tcp_stream(socket);
    session
        .handshake()
        .map_err(|error| format!("SSH handshake failed: {error}"))?;
    let actual = fingerprint(&session)?;
    let (key, key_kind) = session
        .host_key()
        .ok_or("The server did not provide a host key.")?;
    let key_type = match key_kind {
        HostKeyType::Rsa => "ssh-rsa",
        HostKeyType::Dss => "ssh-dss",
        HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
        HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
        HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
        HostKeyType::Ed25519 => "ssh-ed25519",
        HostKeyType::Unknown => "unknown",
    };
    let host_key = STANDARD.encode(key);
    match database.find_known_host(host.trim(), port, key_type)? {
        Some(known) if known.fingerprint == actual && known.public_key == host_key => {}
        Some(known) => {
            return Err(format!(
                "HOST_KEY_CHANGED|{}|{}|{}|{}",
                known.fingerprint, actual, key_type, host_key
            ))
        }
        None => {
            return Err(format!(
                "HOST_KEY_REQUIRED|{}|{}|{}",
                actual, key_type, host_key
            ))
        }
    }
    let methods = session
        .auth_methods(username.trim())
        .unwrap_or("")
        .to_string();
    let mut authenticated = session
        .userauth_password(username.trim(), &password)
        .is_ok();
    if !authenticated && (methods.is_empty() || methods.contains("keyboard-interactive")) {
        let mut prompt = PasswordPrompter(password.clone());
        authenticated = session
            .userauth_keyboard_interactive(username.trim(), &mut prompt)
            .is_ok();
    }
    password.zeroize();
    if !authenticated {
        return Err("Password authentication failed; the public key was not installed.".into());
    }
    let encoded = STANDARD.encode(format!("{}\n", public_key.trim()));
    let command = format!("umask 077; mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys && (grep -qxF \"$(printf %s {encoded} | base64 -d)\" ~/.ssh/authorized_keys || printf %s {encoded} | base64 -d >> ~/.ssh/authorized_keys)");
    let mut channel = session
        .channel_session()
        .map_err(|error| format!("Unable to open remote command: {error}"))?;
    channel
        .exec(&command)
        .map_err(|error| format!("Unable to install public key: {error}"))?;
    channel.wait_close().map_err(|error| error.to_string())?;
    if channel.exit_status().unwrap_or(1) != 0 {
        return Err("The server rejected the authorized_keys update.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_generator_creates_encrypted_openssh_keypair() {
        let root = std::env::temp_dir().join(format!(
            "charterm-native-key-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock should be valid")
                .as_nanos()
        ));
        let private_path = root.join("id_ed25519");
        fs::create_dir_all(&root).expect("test directory should be created");

        let inspection = generate_ssh_identity_blocking(
            private_path.to_string_lossy().into_owned(),
            "ed25519".into(),
            "CharTerm test".into(),
            "temporary-passphrase".into(),
        )
        .expect("native key generation should succeed");

        let key = PrivateKey::read_openssh_file(&private_path)
            .expect("generated private key should be valid OpenSSH");
        assert!(key.is_encrypted());
        assert!(key.decrypt("temporary-passphrase").is_ok());
        assert!(private_path.with_file_name("id_ed25519.pub").is_file());
        assert_eq!(inspection.algorithm, "ssh-ed25519");
        assert!(inspection.fingerprint.starts_with("SHA256:"));

        let _ = fs::remove_dir_all(root);
    }
}
