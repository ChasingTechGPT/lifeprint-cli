/**
 * LifePrint CLI setup wizard
 * Full onboarding: auth → MCP → wellness → hook install
 */

import { Command } from "@cliffy/command";
import { Select, Confirm } from "@cliffy/prompt";
import { hasValidCredentials } from "../../auth/credentials.ts";
import { browserLogin } from "../../auth/oauth.ts";
import {
  loadWellnessState,
  saveWellnessState,
} from "../../wellness/state.ts";
import {
  installHookScript,
  installWellnessHook,
} from "../../wellness/hook-installer.ts";
import { printBanner } from "../logo.ts";

// --- Steps ---

async function stepAuth(): Promise<boolean> {
  console.log("\n\x1b[1m  Step 1: Authentication\x1b[0m\n");

  if (await hasValidCredentials()) {
    console.log("  Already logged in.\n");
    return true;
  }

  console.log("  You need to log in to continue.\n");
  try {
    const creds = await browserLogin();
    console.log(`\n  Logged in as ${creds.user.email}\n`);
    return true;
  } catch (error) {
    if (error instanceof Error) {
      console.error(`  Login failed: ${error.message}`);
    } else {
      console.error("  Login failed.");
    }
    return false;
  }
}

async function stepMcp(): Promise<void> {
  console.log("\n\x1b[1m  Step 2: MCP Server\x1b[0m\n");

  // Import and reuse MCP install logic
  try {
    const { mcpCommand } = await import("./mcp.ts");
    // Trigger the install action programmatically
    await mcpCommand.parse(["install", "--skip-wellness"]);
    console.log("");
  } catch {
    console.log("  MCP server configuration skipped.");
    console.log('  You can run "lifeprint mcp install" later.\n');
  }
}

interface WellnessSetupResult {
  sessionLimit: {
    enabled: boolean;
    durationMinutes: number;
    cooldownMinutes: number;
  };
  powerBreaks: {
    enabled: boolean;
    intervalMinutes: number;
  };
}

async function stepSessionLimit(): Promise<WellnessSetupResult["sessionLimit"]> {
  console.log("\n\x1b[1m  Step 3: Session Time Limit\x1b[0m\n");

  console.log("  Locks you out of Claude Code until you complete a LifePrint");
  console.log("  activity (walk, meditation, workout) or the cooldown expires.\n");

  const duration: string = await Select.prompt({
    message: "Do you want to set a working session time limit?",
    options: [
      { name: "2 hours", value: "120" },
      { name: "3 hours", value: "180" },
      { name: "4 hours", value: "240" },
      { name: "No thanks", value: "0" },
    ],
  });

  if (duration === "0") {
    return { enabled: false, durationMinutes: 0, cooldownMinutes: 0 };
  }

  const cooldown: string = await Select.prompt({
    message: "How long should the cooldown be before auto-unlock?",
    options: [
      { name: "15 minutes", value: "15" },
      { name: "30 minutes (Recommended)", value: "30" },
      { name: "1 hour", value: "60" },
    ],
  });

  return {
    enabled: true,
    durationMinutes: parseInt(duration),
    cooldownMinutes: parseInt(cooldown),
  };
}

async function stepPowerBreaks(): Promise<WellnessSetupResult["powerBreaks"]> {
  console.log("\n\x1b[1m  Step 4: Power Breaks\x1b[0m\n");

  console.log('  Quick micro-activities to stay sharp:');
  console.log('  "2 min box breathing" / "25 pushups" / "5 min stretch"\n');

  const interval: string = await Select.prompt({
    message: "Do you want mid-work power breaks?",
    options: [
      { name: "Every 30 minutes", value: "30" },
      { name: "Every 45 minutes (Recommended)", value: "45" },
      { name: "Every 60 minutes", value: "60" },
      { name: "No thanks", value: "0" },
    ],
  });

  if (interval === "0") {
    return { enabled: false, intervalMinutes: 0 };
  }

  return {
    enabled: true,
    intervalMinutes: parseInt(interval),
  };
}

async function stepInstall(
  sessionLimit: WellnessSetupResult["sessionLimit"],
  powerBreaks: WellnessSetupResult["powerBreaks"],
): Promise<void> {
  console.log("\n\x1b[1m  Step 5: Installing\x1b[0m\n");

  // Write wellness config
  const state = await loadWellnessState();
  state.config.sessionLimit = sessionLimit;
  state.config.powerBreaks = powerBreaks;
  await saveWellnessState(state);
  console.log("  Wellness config saved.");

  // Only install hook if at least one feature is enabled
  if (sessionLimit.enabled || powerBreaks.enabled) {
    const scriptPath = await installHookScript();
    console.log(`  Hook script installed: ${scriptPath}`);

    await installWellnessHook();
    console.log("  Claude Code hook configured.");
  }

  // Print summary
  console.log("\n\x1b[1m  Setup Complete!\x1b[0m\n");

  if (sessionLimit.enabled) {
    const hours = sessionLimit.durationMinutes / 60;
    console.log(
      `  Session limit: ${hours} hours (${sessionLimit.cooldownMinutes} min cooldown)`,
    );
  }
  if (powerBreaks.enabled) {
    console.log(`  Power breaks: Every ${powerBreaks.intervalMinutes} minutes`);
  }
  if (!sessionLimit.enabled && !powerBreaks.enabled) {
    console.log("  No wellness features enabled.");
    console.log('  Run "lifeprint wellness configure" to set up later.');
    return;
  }

  console.log("\n  \x1b[33mRestart Claude Code to activate.\x1b[0m\n");
  console.log("  Useful commands:");
  console.log("    lifeprint wellness status    — Check session timer");
  console.log("    lifeprint wellness complete  — Complete a break");
  console.log("    lifeprint wellness disable   — Turn off enforcement");
  console.log("");
}

// --- Exported entry points ---

/**
 * Run only the wellness configuration steps (used by `lifeprint wellness configure`)
 */
export async function runWellnessSetup(): Promise<void> {
  const sessionLimit = await stepSessionLimit();
  const powerBreaks = await stepPowerBreaks();
  await stepInstall(sessionLimit, powerBreaks);
}

/**
 * Full setup wizard command
 */
export const setupCommand = new Command()
  .description("Full LifePrint CLI setup wizard")
  .action(async () => {
    // Step 1: Auth (before banner so login URL doesn't clutter the branded screen)
    const authed = await stepAuth();
    if (!authed) {
      console.log("\n  Setup requires authentication. Please try again.\n");
      Deno.exit(1);
    }

    // Step 2: MCP Server
    await stepMcp();

    // Show banner right before the interactive wellness questions
    printBanner();

    // Step 3 & 4: Wellness
    const wantsWellness = await Confirm.prompt({
      message: "Would you like to set up wellness enforcement?",
      default: true,
    });

    if (wantsWellness) {
      const sessionLimit = await stepSessionLimit();
      const powerBreaks = await stepPowerBreaks();
      await stepInstall(sessionLimit, powerBreaks);
    } else {
      console.log('\n  Skipped. Run "lifeprint wellness configure" anytime.\n');
    }
  });
