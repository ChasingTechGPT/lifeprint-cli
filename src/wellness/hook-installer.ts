/**
 * Hook installer for Claude Code UserPromptSubmit integration
 * Manages ~/.claude/settings.json and ~/.lifeprint/hooks/wellness-check.sh
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { getConfigDir } from "../auth/credentials.ts";

// --- Types ---

interface ClaudeHookCommand {
  type: "command";
  command: string;
}

interface ClaudeHookMatcher {
  tools?: string[];
  [key: string]: unknown;
}

interface ClaudeHookRule {
  matcher: ClaudeHookMatcher;
  hooks: ClaudeHookCommand[];
}

interface ClaudeHookEntry {
  hooks?: {
    UserPromptSubmit?: ClaudeHookRule[];
    [key: string]: ClaudeHookRule[] | undefined;
  };
  [key: string]: unknown;
}

// --- Paths ---

function getClaudeSettingsPath(): string {
  const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
  return join(home, ".claude", "settings.json");
}

function getHooksDir(): string {
  return join(getConfigDir(), "hooks");
}

function getHookScriptPath(): string {
  return join(getHooksDir(), "wellness-check.sh");
}

// --- Hook Script ---

function generateHookScript(detectedBinaryPath?: string): string {
  const lines: string[] = [
    "#!/bin/bash",
    "# LifePrint Wellness Check Hook for Claude Code",
    "# Installed by: lifeprint setup",
    "#",
    "# This script is called by Claude Code's UserPromptSubmit hook.",
    "# It delegates to the lifeprint CLI for wellness enforcement.",
    "",
    'LIFEPRINT_BIN="${LIFEPRINT_PATH:-}"',
  ];

  // If we detected the binary at install time, hardcode it as first choice
  if (detectedBinaryPath && detectedBinaryPath !== "lifeprint") {
    lines.push(
      `[ -z "$LIFEPRINT_BIN" ] && [ -x "${detectedBinaryPath}" ] && LIFEPRINT_BIN="${detectedBinaryPath}"`,
    );
  }

  lines.push(
    '[ -z "$LIFEPRINT_BIN" ] && [ -x "$HOME/.deno/bin/lifeprint" ] && LIFEPRINT_BIN="$HOME/.deno/bin/lifeprint"',
    '[ -z "$LIFEPRINT_BIN" ] && LIFEPRINT_BIN=$(which lifeprint 2>/dev/null)',
    '[ -z "$LIFEPRINT_BIN" ] && [ -x "/usr/local/bin/lifeprint" ] && LIFEPRINT_BIN="/usr/local/bin/lifeprint"',
    '[ -z "$LIFEPRINT_BIN" ] && exit 0  # Can\'t find binary, don\'t block',
    "",
    'exec "$LIFEPRINT_BIN" wellness check',
  );

  return lines.join("\n") + "\n";
}

/**
 * Install the hook shell script to ~/.lifeprint/hooks/wellness-check.sh
 */
export async function installHookScript(): Promise<string> {
  const hooksDir = getHooksDir();
  await ensureDir(hooksDir);

  // Try to detect the lifeprint binary path
  let detectedPath: string | undefined;
  const candidates = [
    join(Deno.env.get("HOME") || "", ".deno", "bin", "lifeprint"),
    "/usr/local/bin/lifeprint",
  ];

  for (const p of candidates) {
    try {
      await Deno.stat(p);
      detectedPath = p;
      break;
    } catch {
      continue;
    }
  }

  if (!detectedPath) {
    try {
      const which = new Deno.Command("which", { args: ["lifeprint"] });
      const { success, stdout } = await which.output();
      if (success) {
        detectedPath = new TextDecoder().decode(stdout).trim();
      }
    } catch {
      // Not in PATH
    }
  }

  const scriptPath = getHookScriptPath();
  const scriptContent = generateHookScript(detectedPath);
  await Deno.writeTextFile(scriptPath, scriptContent);

  // Make executable
  if (Deno.build.os !== "windows") {
    await Deno.chmod(scriptPath, 0o755);
  }

  return scriptPath;
}

/**
 * Add UserPromptSubmit hook entry to ~/.claude/settings.json
 * Preserves all existing hooks and settings.
 */
export async function installWellnessHook(): Promise<void> {
  const settingsPath = getClaudeSettingsPath();
  const hookScriptPath = getHookScriptPath();

  // Ensure ~/.claude/ directory exists
  const claudeDir = join(
    Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "",
    ".claude",
  );
  await ensureDir(claudeDir);

  // Read existing settings
  let settings: ClaudeHookEntry = {};
  try {
    const content = await Deno.readTextFile(settingsPath);
    settings = JSON.parse(content);
  } catch {
    // File doesn't exist or is invalid
  }

  // Ensure hooks structure
  if (!settings.hooks) {
    settings.hooks = {};
  }
  if (!settings.hooks.UserPromptSubmit) {
    settings.hooks.UserPromptSubmit = [];
  }

  // Check if already installed (deduplicate)
  const hookCommand = hookScriptPath;
  const alreadyInstalled = settings.hooks.UserPromptSubmit.some(
    (rule) =>
      rule.hooks?.some(
        (h) => h.type === "command" && h.command === hookCommand,
      ),
  );

  if (alreadyInstalled) {
    return; // Already installed, nothing to do
  }

  // Add the hook entry (Claude Code expects { matcher: {}, hooks[] } format)
  settings.hooks.UserPromptSubmit.push({
    matcher: {},
    hooks: [
      {
        type: "command",
        command: hookCommand,
      },
    ],
  });

  // Write back
  await Deno.writeTextFile(settingsPath, JSON.stringify(settings, null, 2));
}

/**
 * Remove the wellness hook from ~/.claude/settings.json
 */
export async function uninstallWellnessHook(): Promise<void> {
  const settingsPath = getClaudeSettingsPath();
  const hookScriptPath = getHookScriptPath();

  try {
    const content = await Deno.readTextFile(settingsPath);
    const settings: ClaudeHookEntry = JSON.parse(content);

    if (settings.hooks?.UserPromptSubmit) {
      settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
        (rule) =>
          !rule.hooks?.some(
            (h) => h.type === "command" && h.command === hookScriptPath,
          ),
      );

      // Clean up empty arrays
      if (settings.hooks.UserPromptSubmit.length === 0) {
        delete settings.hooks.UserPromptSubmit;
      }
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }

      await Deno.writeTextFile(settingsPath, JSON.stringify(settings, null, 2));
    }
  } catch {
    // Settings file doesn't exist or is invalid
  }

  // Also remove the hook script
  try {
    await Deno.remove(hookScriptPath);
  } catch {
    // Script doesn't exist
  }
}

/**
 * Check if the wellness hook is currently installed
 */
export async function isHookInstalled(): Promise<boolean> {
  const settingsPath = getClaudeSettingsPath();
  const hookScriptPath = getHookScriptPath();

  try {
    const content = await Deno.readTextFile(settingsPath);
    const settings: ClaudeHookEntry = JSON.parse(content);
    return (
      settings.hooks?.UserPromptSubmit?.some(
        (rule) =>
          rule.hooks?.some(
            (h) => h.type === "command" && h.command === hookScriptPath,
          ),
      ) ?? false
    );
  } catch {
    return false;
  }
}
