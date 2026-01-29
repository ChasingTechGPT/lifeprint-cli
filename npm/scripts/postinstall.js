const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const GITHUB_REPO = "ChasingTechGPT/lifeprint-cli";
const VERSION = require("../package.json").version;

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

  throw new Error(`Unsupported platform: ${platform} ${arch}`);
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const handler = (response) => {
      // Follow redirects (GitHub releases redirect to S3)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = response.headers.location;
        const mod = redirectUrl.startsWith("https") ? https : http;
        mod.get(redirectUrl, handler).on("error", reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(dest);
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    };

    https.get(url, { headers: { "User-Agent": "lifeprint-npm" } }, handler)
      .on("error", reject);
  });
}

async function main() {
  const binaryName = getBinaryName();
  const binDir = path.join(__dirname, "..", "bin");
  const dest = path.join(binDir, binaryName);

  // Skip if binary already exists
  if (fs.existsSync(dest)) {
    console.log("LifePrint binary already installed.");
    return;
  }

  const url = `https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/${binaryName}`;

  console.log(`Downloading LifePrint CLI v${VERSION}...`);
  console.log(`  Platform: ${process.platform} (${process.arch})`);

  try {
    await downloadFile(url, dest);
    fs.chmodSync(dest, 0o755);
    console.log("LifePrint CLI installed successfully.");
  } catch (err) {
    console.warn(`\nCould not download pre-built binary: ${err.message}`);
    console.warn("You can install manually: https://lifeprintpro.com/cli\n");
    // Don't fail the npm install — the shim will show a helpful error
  }
}

main();
