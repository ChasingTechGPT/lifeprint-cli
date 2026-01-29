/**
 * Login command - Browser-based OAuth login
 */

import { Command } from "@cliffy/command";
import { browserLogin } from "../../auth/oauth.ts";
import { hasValidCredentials } from "../../auth/credentials.ts";

export const loginCommand = new Command()
  .description("Log in to LifePrint via browser")
  .option("-f, --force", "Force re-login even if already logged in")
  .action(async (options) => {
    // Check if already logged in
    if (!options.force && await hasValidCredentials()) {
      console.log("You are already logged in. Use --force to re-login.");
      return;
    }

    try {
      const credentials = await browserLogin();
      console.log(`\nSuccessfully logged in as ${credentials.user.email}`);
      console.log("You can now use LifePrint CLI commands.");
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Login failed: ${error.message}`);
      } else {
        console.error("Login failed: Unknown error");
      }
      Deno.exit(1);
    }
  });
