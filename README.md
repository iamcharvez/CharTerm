# CharTerm

**Charvez Terminal — One Terminal. Every Connection.**

[![Download CharTerm](https://img.shields.io/badge/Download-CharTerm-22D3EE?style=for-the-badge&logo=github)](https://github.com/iamcharvez/CharTerm/releases/latest)

This repository contains the active CharTerm desktop application. The current build includes a responsive connection dashboard, protocol-aware Quick Connect, searchable saved profiles with unlimited nested groups, favorites, recent sessions, a network scanner, an IPv4/IPv6 subnet calculator, interactive local and remote terminal tabs, persistent local preferences, complete Settings navigation, and the About experience.

CharTerm currently connects through:

- **SSH** — the operating system's OpenSSH client, hosted inside CharTerm's terminal
- **SFTP** — an interactive OpenSSH SFTP session inside CharTerm
- **Telnet** — CharTerm's native TCP/Telnet transport for legacy devices
- **Serial** — direct local COM/TTY access with selectable baud rates
- **Local terminal** — a native operating-system pseudo-terminal

The **Network Scanner** can inspect a single host or an IPv4 CIDR subnet, identify open TCP ports, label common services, cancel an active scan, export results to CSV, and open discovered SSH devices directly in CharTerm. Automatic mode uses Nmap when it is installed and otherwise uses CharTerm's built-in unprivileged TCP scanner. Nmap service-version detection and full host discovery are available when Nmap is selected.

The **IP & Subnet Calculator** supports exact IPv4 and IPv6 CIDR calculations. It displays network boundaries, address capacity, IPv4 masks and usable hosts, canonical and expanded IPv6 forms, binary representations, reverse-DNS pointers, address classification, and adjacent subnet navigation. IPv4 is selected by default.

Only scan devices and networks you own or have explicit authorization to test. TCP connection scans can be logged by destination systems and may trigger security monitoring.

Saved profiles contain only non-secret connection metadata. Passwords are never stored in a profile or ordinary application settings. When **Save password in system vault** is selected, CharTerm stores it through the operating system's protected credential service (Windows Credential Manager, macOS Keychain, or the Linux Secret Service). Otherwise, the password stays only in the current in-memory session or can be entered directly at the terminal prompt. Telnet is unencrypted and should only be used on trusted networks.

Leaving the SSH or SFTP username blank opens an interactive **login as:** prompt, similar to PuTTY. Saved connections can be placed in main groups and any number of nested subgroups. Selecting a parent includes every connection in its descendant groups, and search matches names, hosts, usernames, protocols, serial ports, and group paths.

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

Select **New connection** to connect without typing a command, or open **Local Terminal** for an operating-system shell. On Windows, local sessions launch PowerShell through a native pseudo-terminal. Use `Ctrl+Shift+T` for a new local terminal and `Ctrl+Shift+W` to close the active terminal.

SSH and SFTP require the OpenSSH client (`ssh` and `sftp`) to be available on the computer. It is included with current Windows installations and is commonly preinstalled on Linux and macOS. The app reports a clear in-terminal error if it is unavailable.

When an older trusted device offers only disabled legacy SSH algorithms, CharTerm detects supported host-key, MAC, key-exchange, and cipher negotiation failures and retries automatically with a connection-specific compatibility exception. These exceptions are never enabled globally. Upgrade or reconfigure legacy devices when possible.

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
