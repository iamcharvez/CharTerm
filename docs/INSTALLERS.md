# CharTerm installers

CharTerm uses native GitHub Actions runners to build installation packages for Windows, Linux, and macOS. The workflow is defined in [`.github/workflows/release-installers.yml`](../.github/workflows/release-installers.yml).

## Generated packages

| Platform | Packages                                     | Architectures           |
| -------- | -------------------------------------------- | ----------------------- |
| Windows  | NSIS setup `.exe`, Windows Installer `.msi`  | x64                     |
| Linux    | AppImage, Debian `.deb`, RPM `.rpm`          | x64                     |
| macOS    | application bundle `.app`, disk image `.dmg` | Apple Silicon and Intel |

Every workflow run uploads its packages as GitHub Actions artifacts and creates or updates a draft GitHub Release named `CharTerm v<version>`.

## Build through GitHub

1. Keep the version identical in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`. Run `npm run check:versions` to verify it.
2. Commit and push the source to GitHub.
3. Either run **Build desktop installers** from the repository's **Actions** page, or create and push a matching version tag:

   ```powershell
   git tag v0.4.0
   git push origin v0.4.0
   ```

4. Download the packages from the workflow's **Artifacts** section. For a tagged build, review the draft under **Releases**, attach release notes if needed, and publish it.

The tag should match the version in the three metadata files. The workflow rejects mismatched internal versions before packaging.

## Build locally

Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for the host operating system, then run the matching command:

```powershell
npm ci
npm run bundle:windows
```

```bash
npm ci
npm run bundle:linux
```

```bash
npm ci
npm run bundle:macos
```

Packages are written below `src-tauri/target/release/bundle/`, grouped by bundle type. A platform's installers must be created on that platform (or by the supplied native GitHub runner).

## Signing status

The workflow creates unsigned Windows and Linux packages. macOS packages use Apple's ad-hoc signing identity so the application bundle is structurally signed, but it is not Developer ID signed or notarized. Operating systems can therefore display an unknown-publisher or security warning.

Before a broad public production release, configure Windows code-signing and Apple Developer ID signing/notarization secrets. Do not put private certificates, passwords, or API keys in the repository.
