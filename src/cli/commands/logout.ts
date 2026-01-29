/**
 * Logout command - Clear stored credentials
 */

import { Command } from "@cliffy/command";
import { deleteCredentials, getCurrentUser } from "../../auth/credentials.ts";

export const logoutCommand = new Command()
  .description("Log out and clear stored credentials")
  .action(async () => {
    const user = await getCurrentUser();

    if (!user) {
      console.log("You are not logged in.");
      return;
    }

    await deleteCredentials();
    console.log(`Logged out from ${user.email}`);
  });
