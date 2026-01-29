/**
 * Wellness CLI commands
 * lifeprint wellness check|status|complete|reset|configure|disable|enable
 */

import { Command } from "@cliffy/command";
import { Table } from "@cliffy/table";
import {
  loadWellnessState,
  saveWellnessState,
  isConfigured,
  isBreakActive,
  getTimeWorkedFormatted,
  getTimeUntilNextBreak,
  getTimeUntilSessionLimit,
  getCooldownRemaining,
  completeBreak,
  resetSession,
  formatMs,
} from "../../wellness/state.ts";
import { runHookCheck } from "../../wellness/hook-check.ts";
import {
  installHookScript,
  installWellnessHook,
  uninstallWellnessHook,
  isHookInstalled,
} from "../../wellness/hook-installer.ts";

export const wellnessCommand = new Command()
  .description("Wellness enforcement for coding sessions")
  .command(
    "check",
    new Command()
      .description("Hook entry point — called by Claude Code UserPromptSubmit hook")
      .action(async () => {
        await runHookCheck();
      }),
  )
  .command(
    "status",
    new Command()
      .description("Show current wellness session status")
      .action(async () => {
        const state = await loadWellnessState();

        if (!isConfigured(state)) {
          console.log("Wellness enforcement is not configured.");
          console.log('Run "lifeprint setup" to get started.');
          return;
        }

        console.log("\n  WELLNESS STATUS\n");

        // Config summary
        const configRows: string[][] = [];
        if (state.config.sessionLimit.enabled) {
          configRows.push([
            "Session Limit",
            `${state.config.sessionLimit.durationMinutes} min`,
          ]);
          configRows.push([
            "Cooldown",
            `${state.config.sessionLimit.cooldownMinutes} min`,
          ]);
        } else {
          configRows.push(["Session Limit", "Disabled"]);
        }
        if (state.config.powerBreaks.enabled) {
          configRows.push([
            "Power Breaks",
            `Every ${state.config.powerBreaks.intervalMinutes} min`,
          ]);
        } else {
          configRows.push(["Power Breaks", "Disabled"]);
        }

        const configTable = new Table()
          .header(["Setting", "Value"])
          .body(configRows)
          .padding(2);
        console.log(configTable.toString());

        // Session info
        console.log("");
        if (state.session.startedAt) {
          const timeWorked = getTimeWorkedFormatted(state);
          console.log(`  Session: ${timeWorked} (${state.session.promptCount} prompts)`);

          if (state.config.sessionLimit.enabled) {
            const remaining = getTimeUntilSessionLimit(state);
            if (remaining !== null && remaining > 0) {
              console.log(`  Session limit in: ${formatMs(remaining)}`);
            }
          }

          if (state.config.powerBreaks.enabled) {
            const nextBreak = getTimeUntilNextBreak(state);
            if (nextBreak !== null && nextBreak > 0) {
              console.log(`  Next power break in: ${formatMs(nextBreak)}`);
            }
          }
        } else {
          console.log("  No active session.");
        }

        // Break status
        if (isBreakActive(state)) {
          const cooldown = getCooldownRemaining(state);
          console.log(`\n  BREAK ACTIVE: ${state.currentBreak.type}`);
          console.log(`  Activity: ${state.currentBreak.activityName ?? "N/A"}`);
          console.log(`  Auto-unlock in: ${formatMs(cooldown)}`);
          console.log('  Complete with: lifeprint wellness complete');
        }

        // Today's stats
        if (state.powerBreak.completedToday > 0) {
          console.log(
            `\n  Power breaks completed today: ${state.powerBreak.completedToday}`,
          );
        }

        // Hook status
        const hookActive = await isHookInstalled();
        console.log(`\n  Hook installed: ${hookActive ? "Yes" : "No"}`);
        console.log("");
      }),
  )
  .command(
    "complete",
    new Command()
      .description("Mark the current wellness break as completed")
      .action(async () => {
        const state = await loadWellnessState();

        if (!isBreakActive(state)) {
          console.log("No active break to complete.");
          return;
        }

        const newState = completeBreak(state);
        await saveWellnessState(newState);

        console.log("Break completed! You can continue coding.");
        if (state.currentBreak.activityName) {
          console.log(`  Activity: ${state.currentBreak.activityName}`);
        }
      }),
  )
  .command(
    "reset",
    new Command()
      .description("Reset the session timer")
      .action(async () => {
        const state = await loadWellnessState();
        const newState = resetSession(state);
        await saveWellnessState(newState);
        console.log("Session timer reset.");
      }),
  )
  .command(
    "disable",
    new Command()
      .description("Disable wellness enforcement (config is preserved)")
      .action(async () => {
        const state = await loadWellnessState();
        state.config.sessionLimit.enabled = false;
        state.config.powerBreaks.enabled = false;
        await saveWellnessState(state);
        await uninstallWellnessHook();
        console.log("Wellness enforcement disabled.");
        console.log('Run "lifeprint wellness enable" to re-enable.');
      }),
  )
  .command(
    "enable",
    new Command()
      .description("Re-enable wellness enforcement with saved config")
      .action(async () => {
        const state = await loadWellnessState();

        // Re-enable with previously saved durations
        if (state.config.sessionLimit.durationMinutes > 0) {
          state.config.sessionLimit.enabled = true;
        }
        if (state.config.powerBreaks.intervalMinutes > 0) {
          state.config.powerBreaks.enabled = true;
        }

        if (
          !state.config.sessionLimit.enabled &&
          !state.config.powerBreaks.enabled
        ) {
          console.log("No previous wellness config found.");
          console.log('Run "lifeprint setup" to configure wellness enforcement.');
          return;
        }

        await saveWellnessState(state);
        await installHookScript();
        await installWellnessHook();

        console.log("Wellness enforcement re-enabled.");
        if (state.config.sessionLimit.enabled) {
          console.log(
            `  Session limit: ${state.config.sessionLimit.durationMinutes} min`,
          );
        }
        if (state.config.powerBreaks.enabled) {
          console.log(
            `  Power breaks: Every ${state.config.powerBreaks.intervalMinutes} min`,
          );
        }
        console.log("\nRestart Claude Code to activate.");
      }),
  )
  .command(
    "configure",
    new Command()
      .description("Interactive configuration wizard")
      .action(async () => {
        // Import setup wellness steps dynamically
        const { runWellnessSetup } = await import("./setup.ts");
        await runWellnessSetup();
      }),
  );
