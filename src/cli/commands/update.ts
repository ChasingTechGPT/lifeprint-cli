/**
 * Update command - Self-update the CLI binary
 */

import { Command } from "@cliffy/command";
import { VERSION } from "../mod.ts";

const GITHUB_API =
  "https://api.github.com/repos/ChasingTechGPT/lifeprint-cli/releases/latest";

function getPlatformBinary(): string {
  const os = Deno.build.os;
  const arch = Deno.build.arch;

  if (os === "darwin" && arch === "aarch64") return "lifeprint-macos-arm64";
  if (os === "darwin") return "lifeprint-macos-x64";
  if (os === "linux") return "lifeprint-linux";
  if (os === "windows") return "lifeprint-windows.exe";

  throw new Error(`Unsupported platform: ${os}-${arch}`);
}

function compareVersions(current: string, latest: string): number {
  const a = current.split(".").map(Number);
  const b = latest.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((b[i] ?? 0) > (a[i] ?? 0)) return 1;
    if ((b[i] ?? 0) < (a[i] ?? 0)) return -1;
  }
  return 0;
}

export const updateCommand = new Command()
  .description("Update the LifePrint CLI to the latest version")
  .action(async () => {
    console.log(`Current version: ${VERSION}`);
    console.log("Checking for updates...");

    // Fetch latest release
    let latestVersion: string;
    let assets: { name: string; browser_download_url: string }[];
    try {
      const response = await fetch(GITHUB_API, {
        headers: { Accept: "application/vnd.github.v3+json" },
      });
      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}`);
      }
      const data = (await response.json()) as {
        tag_name: string;
        assets: { name: string; browser_download_url: string }[];
      };
      latestVersion = data.tag_name.replace(/^v/, "");
      assets = data.assets;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to check for updates: ${msg}`);
      console.error(
        "Fallback: curl -fsSL https://lifeprintpro.com/cli/install.sh | bash"
      );
      Deno.exit(1);
    }

    // Compare versions
    if (compareVersions(VERSION, latestVersion) <= 0) {
      console.log(`Already on latest version (${VERSION})`);
      return;
    }

    console.log(`Updating ${VERSION} → ${latestVersion}...`);

    // Find the right binary for this platform
    const binaryName = getPlatformBinary();
    const asset = assets.find((a) => a.name === binaryName);
    if (!asset) {
      console.error(`No binary found for ${binaryName} in latest release.`);
      console.error(
        "Fallback: curl -fsSL https://lifeprintpro.com/cli/install.sh | bash"
      );
      Deno.exit(1);
    }

    // Download the new binary
    let binaryData: Uint8Array;
    try {
      console.log(`Downloading ${binaryName}...`);
      const response = await fetch(asset.browser_download_url);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }
      binaryData = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Download failed: ${msg}`);
      console.error(
        "Fallback: curl -fsSL https://lifeprintpro.com/cli/install.sh | bash"
      );
      Deno.exit(1);
    }

    // Replace the current binary (atomic rename)
    const currentPath = Deno.execPath();
    const tmpPath = currentPath + ".update";

    try {
      await Deno.writeFile(tmpPath, binaryData, { mode: 0o755 });
      await Deno.rename(tmpPath, currentPath);
      console.log(`Updated to ${latestVersion}`);
    } catch (error) {
      // Clean up tmp file on failure
      try {
        await Deno.remove(tmpPath);
      } catch {
        // ignore cleanup error
      }
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to replace binary: ${msg}`);
      console.error(
        "Fallback: curl -fsSL https://lifeprintpro.com/cli/install.sh | bash"
      );
      Deno.exit(1);
    }
  });
