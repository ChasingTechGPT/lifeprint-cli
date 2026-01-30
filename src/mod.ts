/**
 * LifePrint CLI entry point
 */

import { cli } from "./cli/mod.ts";
import { hasValidCredentials } from "./auth/credentials.ts";
import { isConfigured, loadWellnessState } from "./wellness/state.ts";
import { checkForUpdate } from "./cli/update-check.ts";

/**
 * Check if this is a first run (no auth + no wellness config).
 * If so, auto-launch the setup wizard.
 */
async function shouldAutoSetup(): Promise<boolean> {
  // Only trigger on bare `lifeprint` with no args (or `lifeprint --help`)
  if (Deno.args.length > 0) return false;

  const loggedIn = await hasValidCredentials();
  if (loggedIn) {
    const state = await loadWellnessState();
    if (isConfigured(state)) return false;
  }
  return true;
}

// Run the CLI
if (import.meta.main) {
  try {
    if (await shouldAutoSetup()) {
      const { setupCommand } = await import("./cli/commands/setup.ts");
      await setupCommand.parse([]);
    } else {
      await cli.parse(Deno.args);
    }

    // Fire-and-forget update check (skip for wellness and update commands)
    const cmd = Deno.args[0];
    if (cmd !== "wellness" && cmd !== "update") {
      checkForUpdate().catch(() => {});
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unknown command")) {
      // Cliffy already prints the error, just exit
      Deno.exit(1);
    }
    console.error(error);
    Deno.exit(1);
  }
}
