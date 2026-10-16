import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const tauriConfig = JSON.parse(
  await readFile(
    new URL("../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
);
const cargoToml = await readFile(
  new URL("../src-tauri/Cargo.toml", import.meta.url),
  "utf8",
);
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const versions = {
  "package.json": packageJson.version,
  "src-tauri/Cargo.toml": cargoVersion,
  "src-tauri/tauri.conf.json": tauriConfig.version,
};

const uniqueVersions = new Set(Object.values(versions));

if (uniqueVersions.size !== 1 || uniqueVersions.has(undefined)) {
  console.error("CharTerm release versions do not match:");
  for (const [file, version] of Object.entries(versions)) {
    console.error(`  ${file}: ${version ?? "missing"}`);
  }
  process.exit(1);
}

if (process.env.GITHUB_REF_TYPE === "tag") {
  const expectedTag = `v${packageJson.version}`;
  const actualTag = process.env.GITHUB_REF_NAME;

  if (actualTag !== expectedTag) {
    console.error(
      `Release tag ${actualTag ?? "missing"} must match ${expectedTag}.`,
    );
    process.exit(1);
  }
}

console.log(
  `CharTerm version ${packageJson.version} is consistent across release metadata.`,
);
