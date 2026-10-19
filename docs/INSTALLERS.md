# CharTerm installers

CharTerm uses native GitHub Actions runners to build installation packages for Windows, Linux, and macOS. The single release workflow is defined in [`.github/workflows/release-installers.yml`](../.github/workflows/release-installers.yml).

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
3. Either run **Build desktop installers** from the repository's **Actions** page, or create and push an annotated tag from the version in `package.json`:

   ```powershell
   $charTermVersion = (Get-Content package.json | ConvertFrom-Json).version
   git tag -a "v$charTermVersion" -m "CharTerm v$charTermVersion"
   git push origin "v$charTermVersion"
   ```

4. Wait for all four jobs—Windows x64, Linux x64, macOS Apple Silicon, and macOS Intel—to finish successfully.
5. Open the new draft under **Releases**, verify that every expected installer is attached, and select **Publish release**. The README platform buttons then resolve to this release automatically.

The release remains a draft while the native builds are running so visitors never see a partially populated release. Workflow artifacts are also available from the completed Actions run for testing before publication.

The tag must match the version in the three metadata files. The workflow rejects mismatched internal versions and mismatched pushed tags before packaging.

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

The Tauri updater requires every update archive to have a valid signature. Before running the release workflow, add the contents of the private key at `C:\Users\HP\.charterm-release\updater.key` as the GitHub Actions repository secret `TAURI_SIGNING_PRIVATE_KEY`. The corresponding public key is already embedded in the application. The generated private key is outside this repository; back it up securely and never commit it. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is optional for the currently generated unencrypted key and should be configured if the key is regenerated with a password.

Publishing the draft release uploads `latest.json` and signed update artifacts. Installed copies then expose **Check for updates** on Settings → About and verify the archive before installation.

The workflow creates unsigned Windows and Linux packages. macOS packages use Apple's ad-hoc signing identity so the application bundle is structurally signed, but it is not Developer ID signed or notarized. Operating systems can therefore display an unknown-publisher or security warning.

Before a broad public production release, configure Windows code-signing and Apple Developer ID signing/notarization secrets. Do not put private certificates, passwords, or API keys in the repository.
