#!/usr/bin/env node

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

function getBinaryName() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin") {
    return arch === "arm64" ? "lifeprint-macos-arm64" : "lifeprint-macos-x64";
  } else if (platform === "linux") {
    return "lifeprint-linux";
  } else if (platform === "win32") {
    return "lifeprint-windows.exe";
  }

  console.error(`Unsupported platform: ${platform} ${arch}`);
  process.exit(1);
}

function findBinary() {
  const binaryName = getBinaryName();
  const binDir = __dirname;

  // Check local bin directory (set by postinstall)
  const localPath = path.join(binDir, binaryName);
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  // Check if globally installed via install.sh
  const globalPaths = [
    "/usr/local/bin/lifeprint",
    path.join(process.env.HOME || "", ".lifeprint", "bin", "lifeprint"),
  ];

  for (const p of globalPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  console.error(
    "LifePrint binary not found. Try running: npm rebuild lifeprint"
  );
  process.exit(1);
}

const binary = findBinary();
const args = process.argv.slice(2);

try {
  execFileSync(binary, args, { stdio: "inherit" });
} catch (err) {
  if (err.status !== undefined) {
    process.exit(err.status);
  }
  throw err;
}
