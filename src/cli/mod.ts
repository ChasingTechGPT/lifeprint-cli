/**
 * LifePrint CLI main module
 * Sets up the CLI using Cliffy framework
 */

import { Command } from "@cliffy/command";
import { loginCommand } from "./commands/login.ts";
import { logoutCommand } from "./commands/logout.ts";
import { statusCommand } from "./commands/status.ts";
import { mcpCommand } from "./commands/mcp.ts";
import { recipeCommand } from "./commands/recipe.ts";
import { mealplanCommand } from "./commands/mealplan.ts";
import { agendaCommand } from "./commands/agenda.ts";
import { movementCommand } from "./commands/movement.ts";
import { meditationCommand } from "./commands/meditation.ts";
import { householdCommand } from "./commands/household.ts";
import { wellnessCommand } from "./commands/wellness.ts";
import { setupCommand } from "./commands/setup.ts";
import { updateCommand } from "./commands/update.ts";
import { daemonCommand } from "./commands/daemon.ts";
import { renderArtifactCommand } from "./commands/render-artifact.ts";
import { workCommand } from "./commands/work.ts";

export const VERSION = "0.1.5";

export const cli = new Command()
  .name("lifeprint")
  .version(VERSION)
  .description("LifePrint CLI - Manage your wellness journey from the command line")
  .globalOption("-v, --verbose", "Enable verbose output")
  // Auth commands
  .command("login", loginCommand)
  .command("logout", logoutCommand)
  .command("status", statusCommand)
  // MCP commands
  .command("mcp", mcpCommand)
  // Tool commands
  .command("recipe", recipeCommand)
  .command("mealplan", mealplanCommand)
  .command("agenda", agendaCommand)
  .command("movement", movementCommand)
  .command("meditation", meditationCommand)
  .command("household", householdCommand)
  // Wellness & Setup
  .command("wellness", wellnessCommand)
  .command("setup", setupCommand)
  // Daemon
  .command("daemon", daemonCommand)
  // Sage artifact rendering (sage-for-builders)
  .command("render-artifact", renderArtifactCommand)
  // Work session tracking (sage-for-builders + saework)
  .command("work", workCommand)
  // Update
  .command("update", updateCommand);
