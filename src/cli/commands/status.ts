/**
 * Status command - Show authentication status
 */

import { Command } from "@cliffy/command";
import { Table } from "@cliffy/table";
import {
  loadCredentials,
  isExpired,
  getConfigDir,
} from "../../auth/credentials.ts";

export const statusCommand = new Command()
  .description("Show authentication status")
  .action(async () => {
    const credentials = await loadCredentials();

    if (!credentials) {
      console.log("Not logged in. Run 'lifeprint login' to authenticate.");
      return;
    }

    const expired = isExpired(credentials);
    const expiresAt = new Date(credentials.expires_at);
    const timeUntilExpiry = expired
      ? "Expired"
      : formatTimeUntil(expiresAt);

    console.log("\nLifePrint CLI Status\n");

    const table = new Table()
      .header(["Property", "Value"])
      .body([
        ["Status", expired ? "Token expired (will auto-refresh)" : "Logged in"],
        ["User", credentials.user.name],
        ["Email", credentials.user.email],
        ["User ID", credentials.user.id],
        ["Token Expires", timeUntilExpiry],
        ["Scopes", credentials.scopes.join(", ")],
        ["Config Dir", getConfigDir()],
      ])
      .padding(1)
      .indent(2);

    table.render();
    console.log();
  });

/**
 * Format time until a date
 */
function formatTimeUntil(date: Date): string {
  const now = Date.now();
  const diff = date.getTime() - now;

  if (diff < 0) {
    return "Expired";
  }

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days > 1 ? "s" : ""}`;
  }
  if (hours > 0) {
    return `${hours} hour${hours > 1 ? "s" : ""}`;
  }
  return `${minutes} minute${minutes > 1 ? "s" : ""}`;
}
