/**
 * LifePrint CLI entry point
 */

import { cli } from "./cli/mod.ts";

// Run the CLI
if (import.meta.main) {
  try {
    await cli.parse(Deno.args);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unknown command")) {
      // Cliffy already prints the error, just exit
      Deno.exit(1);
    }
    console.error(error);
    Deno.exit(1);
  }
}
