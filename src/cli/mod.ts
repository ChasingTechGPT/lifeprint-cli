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

const VERSION = "0.1.0";

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
  .command("household", householdCommand);
