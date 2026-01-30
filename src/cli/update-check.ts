/**
 * Background update checker
 * Checks GitHub for newer CLI versions once per day
 */

import { join } from "@std/path";
import { VERSION } from "./mod.ts";

const GITHUB_API =
  "https://api.github.com/repos/ChasingTechGPT/lifeprint-cli/releases/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 1500;

interface UpdateCheckCache {
  lastCheck: number;
  latestVersion: string | null;
}

async function getCacheDir(): Promise<string> {
  const home =
    Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "/tmp";
  const dir = join(home, ".lifeprint");
  try {
    await Deno.mkdir(dir, { recursive: true });
  } catch {
    // already exists
  }
  return dir;
}

async function readCache(): Promise<UpdateCheckCache | null> {
  try {
    const dir = await getCacheDir();
    const text = await Deno.readTextFile(join(dir, "update-check.json"));
    return JSON.parse(text) as UpdateCheckCache;
  } catch {
    return null;
  }
}

async function writeCache(cache: UpdateCheckCache): Promise<void> {
  try {
    const dir = await getCacheDir();
    await Deno.writeTextFile(
      join(dir, "update-check.json"),
      JSON.stringify(cache)
    );
  } catch {
    // non-critical
  }
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

/**
 * Check for updates and print a notice to stderr if a newer version exists.
 * Silently does nothing on failure.
 */
export async function checkForUpdate(): Promise<void> {
  try {
    // Check cache first
    const cache = await readCache();
    if (cache && Date.now() - cache.lastCheck < CHECK_INTERVAL_MS) {
      if (cache.latestVersion && compareVersions(VERSION, cache.latestVersion) > 0) {
        printUpdateNotice(cache.latestVersion);
      }
      return;
    }

    // Fetch latest release
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(GITHUB_API, {
      headers: { Accept: "application/vnd.github.v3+json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      await writeCache({ lastCheck: Date.now(), latestVersion: null });
      return;
    }

    const data = (await response.json()) as { tag_name?: string };
    const latestVersion = data.tag_name?.replace(/^v/, "") ?? null;

    await writeCache({ lastCheck: Date.now(), latestVersion });

    if (latestVersion && compareVersions(VERSION, latestVersion) > 0) {
      printUpdateNotice(latestVersion);
    }
  } catch {
    // Silently ignore all errors — update check is non-critical
  }
}

function printUpdateNotice(latestVersion: string): void {
  const encoder = new TextEncoder();
  Deno.stderr.writeSync(
    encoder.encode(
      `\nUpdate available: ${VERSION} → ${latestVersion}  Run \`lifeprint update\` to upgrade.\n\n`
    )
  );
}
