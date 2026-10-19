# CharTerm

**Charvez Terminal — One Terminal. Every Connection.**

[![Latest release](https://img.shields.io/github/v/release/iamcharvez/CharTerm?display_name=tag&sort=semver&style=flat-square&color=22D3EE)](https://github.com/iamcharvez/CharTerm/releases/latest)
[![Release builds](https://github.com/iamcharvez/CharTerm/actions/workflows/release-installers.yml/badge.svg)](https://github.com/iamcharvez/CharTerm/actions/workflows/release-installers.yml)

## Download CharTerm

Choose your platform below. Each button opens the **Assets** section of the latest published GitHub Release, where you can select the installer format and, on macOS, the correct processor architecture.

| Windows | macOS | Linux |
| :---: | :---: | :---: |
| [![Download for Windows](https://img.shields.io/badge/Download_for_Windows-0078D4?style=for-the-badge&logo=windows11&logoColor=white)](https://github.com/iamcharvez/CharTerm/releases/latest#assets) | [![Download for macOS](https://img.shields.io/badge/Download_for_macOS-111111?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/iamcharvez/CharTerm/releases/latest#assets) | [![Download for Linux](https://img.shields.io/badge/Download_for_Linux-FCC624?style=for-the-badge&logo=linux&logoColor=111111)](https://github.com/iamcharvez/CharTerm/releases/latest#assets) |
| `.exe` recommended; `.msi` also available | Apple Silicon and Intel `.dmg` | AppImage, `.deb`, and `.rpm` |

> The buttons show the newest **published** release. Draft releases are visible only to the repository owner and do not replace the public download until they are published.

This repository contains the active CharTerm desktop application. The current build includes a responsive connection dashboard, protocol-aware Quick Connect, searchable saved profiles with unlimited nested groups, favorites, recent sessions, a network scanner, an IPv4/IPv6 subnet calculator, reusable SSH identities, recoverable workspaces with single, column, row, and grid layouts, a transfer-aware dual-pane SFTP file manager, a native connection and background-job registry, bounded SQLite activity logs, complete Settings navigation, and signed automatic updates.

CharTerm currently connects through:

- **SSH** — the operating system's OpenSSH client hosted inside CharTerm, with password, reusable identity, and SSH-agent authentication plus per-profile legacy-device compatibility
- **SFTP** — a native, dual-pane transfer center for browsing, recursive folder uploads and downloads, non-blocking jobs, percentage, throughput and ETA, cancellation, collision confirmation, parent-folder navigation, renaming, creating folders, and deleting remote items
- **Telnet** — CharTerm's native TCP/Telnet transport for legacy devices
- **Serial** — direct local COM/TTY access with device detection, friendly hardware details, refresh, manual port entry, common baud-rate presets, and custom speed input
- **Other TCP** — a raw TCP console for any custom host and port
- **Local terminal** — a native operating-system pseudo-terminal

Live SSH, Serial, raw TCP, and local terminal sessions include a clearly labeled **X/Y/Z Transfer** toolbar action. It opens the modern transfer panel with ZMODEM, XMODEM, YMODEM, and Kermit send/receive modes. Transfers use the active terminal transport, show file progress, throughput and elapsed time, and can be cancelled without blocking the interface. The matching helper (`rz`/`sz`, `rx`/`sx`, `rb`/`sb`, or Kermit server mode) must be available at the other endpoint. Binary modem transfer is intentionally disabled for Telnet because Telnet negotiation can rewrite control bytes; use SSH, Serial, raw TCP, or the dedicated SFTP file manager instead.

The **Network Scanner** accepts multiple hosts and IPv4 CIDR subnets in one scan, keeps running when you move to another CharTerm page, and streams discovered devices into live results. It identifies open TCP ports, shows MAC addresses and Nmap vendor information when available, exports results to CSV, and opens SSH and Telnet services directly in CharTerm. Detected HTTP and HTTPS services open through the operating system's default browser while preserving the discovered host and port. Optional advanced tuning controls the per-port timeout and parallel checks. Automatic mode uses Nmap when installed and otherwise uses CharTerm's built-in unprivileged TCP scanner.

The **IP & Subnet Calculator** supports exact IPv4 and IPv6 CIDR calculations. It displays network boundaries, address capacity, IPv4 masks and usable hosts, canonical and expanded IPv6 forms, binary representations, reverse-DNS pointers, address classification, and adjacent subnet navigation. IPv4 is selected by default.

Only scan devices and networks you own or have explicit authorization to test. TCP connection scans can be logged by destination systems and may trigger security monitoring.

Application records are stored in a versioned SQLite database in the operating system's application-data directory. Existing browser-storage profiles are imported once on first desktop launch. Saved profiles contain only non-secret connection metadata and can be edited from Saved Connections, Favorites, or Recent Sessions. Passwords are never displayed or stored in SQLite or ordinary application settings. The editor can keep, replace, or remove a saved password. When **Save password in system vault** is selected, CharTerm stores it through the operating system's protected credential service (Windows Credential Manager, macOS Keychain, or the Linux Secret Service). Otherwise, the password stays only in the current in-memory session or can be entered directly at the terminal prompt. Telnet is unencrypted and should only be used on trusted networks.

Settings → **Activity Logs** provides searchable lifecycle history and a live view of recent background work. Retention is bounded simultaneously by age, maximum event count, and approximate storage size; all three limits and the minimum severity are adjustable. Logs contain application, connection, scan, transfer, and workspace lifecycle events only. Terminal contents, typed commands, passwords, passphrases, tokens, private keys, and transferred file names are excluded. Logs can be exported as newline-delimited JSON or cleared at any time.

The **SSH Identities** workspace uses CharTerm's native Rust cryptography engine to generate encrypted Ed25519 or RSA 4096 OpenSSH keys without PuTTY or `ssh-keygen`. It can import and edit identities, pair an OpenSSH certificate, change a private-key passphrase atomically, copy public keys, and install a public key on a saved server through a guided first-login flow. Private keys stay in files chosen by the user; only their paths and public metadata are stored in CharTerm. Private-key passphrases can optionally be protected in the operating-system credential vault. Quick Connect supports Automatic, explicit Identity, SSH Agent, and Password authentication modes, with password fallback where selected.

Password entry fields include a **Show/Hide** control so the current value can be checked before connecting. Passwords already stored in the system vault remain hidden and cannot be revealed by the application. SFTP automatically supports both standard password and keyboard-interactive password authentication, in addition to SSH agent authentication.

Leaving the SSH username blank opens an interactive **login as:** prompt, similar to PuTTY. For SFTP, a blank username opens the sign-in panel inside the file manager. SFTP server fingerprints are verified on first connection and remembered locally so unexpected host-key changes are shown before authentication. Saved connections can be placed in main groups and any number of nested subgroups. Selecting a parent includes every connection in its descendant groups, and search matches names, hosts, usernames, protocols, serial ports, and group paths.

## Run the web preview

```powershell
npm install
npm run dev
```

## Run the desktop app

Install the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system, including Rust, then run:

```powershell
npm install
npm run tauri dev
```

Select **New connection** to connect without typing a command. Quick Connect includes SSH, SFTP, Telnet, Serial, custom TCP, and a one-click Local shell. Terminal Sessions keeps every active connection in a tab and also provides a dedicated **New local terminal** action; SFTP sessions open in the integrated file manager.

Password authentication is the default for SSH and SFTP. The optional advanced authentication panel adds reusable identities, SSH-agent authentication, and automatic fallback. Serial Quick Connect detects available COM/TTY devices and offers common speed presets from 300 through 921600, while still accepting any manual baud rate from 50 through 4,000,000. Its advanced panel exposes character encoding, data bits, stop bits, parity, and hardware or software flow control.

Active terminal and SFTP sessions remain mounted when navigating to another CharTerm page, so returning to Terminal Sessions does not reconnect or reset the live session. When session recovery is enabled, open tabs and the split layout are restored after restart without persisting passwords or key passphrases. Named workspace snapshots can also be saved and restored. The workspace supports up to four visible panes with column, row, and grid arrangements, and each pane can be focused back into a full-size single view without closing its session. Press **Ctrl+K** to search tools and profiles from anywhere.

SSH terminal sessions require the OpenSSH client (`ssh`) to be available on the computer. It is included with current Windows installations and is commonly preinstalled on Linux and macOS. Key generation is built into CharTerm. SFTP uses CharTerm's bundled native SFTP engine and does not require the command-line `sftp` program.

When an older trusted device offers only disabled legacy SSH algorithms, CharTerm detects supported host-key, MAC, key-exchange, and cipher negotiation failures and retries automatically with a connection-specific compatibility exception. These exceptions are never enabled globally. SFTP host keys are stored in SQLite with the full public key and fingerprint; changed keys are blocked until explicitly reviewed. Upgrade or reconfigure legacy devices when possible.

## Verify

```powershell
npm test
npm run build
npm run check:versions
```

The About page reads the application name and version from Tauri metadata in the desktop runtime. The browser preview uses the same version from `package.json`, injected at build time. The footer year is calculated at runtime.

## Installers

The release workflow builds native packages for every supported desktop platform:

- Windows: NSIS `.exe` and `.msi`
- Linux: AppImage, `.deb`, and `.rpm`
- macOS: `.dmg` and `.app` for Apple Silicon and Intel

See [Installer builds](docs/INSTALLERS.md) for local commands, GitHub release instructions, output formats, and signing notes.

## License

CharTerm is proprietary software that is free to use for personal, educational, professional, and internal business purposes. Redistribution, resale, sublicensing, and distribution of modified versions are not permitted without written authorization.

Copyright © 2026 Charlie M. Chavez. All Rights Reserved.

See the complete [CharTerm Software License Agreement](LICENSE.md).

**Private by Design. Reliable by Default.**
