/**
 * Household commands
 */

import { Command } from "@cliffy/command";
import { Table } from "@cliffy/table";
import { callTool, AuthRequiredError } from "../../api/client.ts";

export const householdCommand = new Command()
  .description("View household information")
  .command("members", new Command()
    .description("List household members")
    .action(async () => {
      try {
        const result = await callTool<HouseholdResponse>("get_household_members", {});

        if (!result.members || result.members.length === 0) {
          console.log("No household members found.");
          console.log("You can add household members in the LifePrint app.");
          return;
        }

        console.log("\nHousehold Members\n");

        const rows: string[][] = [];
        const headers = ["Name", "Role", "Dietary", "Status"];

        for (const member of result.members) {
          const dietary = member.dietary_preferences?.join(", ") || "-";
          const status = member.is_active ? "Active" : "Inactive";
          rows.push([member.name, member.role || "-", dietary, status]);
        }

        const table = new Table()
          .header(headers)
          .body(rows)
          .padding(1)
          .indent(2);

        table.render();

        // Summary
        console.log(`\n  Total: ${result.members.length} member${result.members.length > 1 ? "s" : ""}`);
        console.log();
      } catch (error) {
        handleError(error);
      }
    }));

interface HouseholdMember {
  id: string;
  name: string;
  role?: string;
  dietary_preferences?: string[];
  allergies?: string[];
  is_active: boolean;
}

interface HouseholdResponse {
  members: HouseholdMember[];
}

function handleError(error: unknown): void {
  if (error instanceof AuthRequiredError) {
    console.error("Not logged in. Run 'lifeprint login' first.");
  } else if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error("An unexpected error occurred.");
  }
  Deno.exit(1);
}
