import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const defaultKey = join(homedir(), ".charterm-release", "updater.key");
const key = process.env.CHARTERM_SIGNING_KEY_PATH || defaultKey;
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && existsSync(key)) {
  process.env.TAURI_SIGNING_PRIVATE_KEY = key;
}
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  console.error("Missing updater signing key. Set TAURI_SIGNING_PRIVATE_KEY or CHARTERM_SIGNING_KEY_PATH.");
  process.exit(1);
}

const cli = join(process.cwd(), "node_modules", "@tauri-apps", "cli", "tauri.js");
const result = spawnSync(process.execPath, [cli, "build", ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit",
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
