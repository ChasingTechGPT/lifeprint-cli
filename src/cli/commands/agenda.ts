/**
 * Agenda commands
 */

import { Command } from "@cliffy/command";
import { Table } from "@cliffy/table";
import { callTool, AuthRequiredError } from "../../api/client.ts";

export const agendaCommand = new Command()
  .description("View your daily agenda")
  .command("today", new Command()
    .description("Show today's agenda")
    .action(async () => {
      try {
        const today = new Date().toISOString().split("T")[0];
        const result = await callTool<AgendaResponse>("get_agenda", {
          date: today,
        });

        printAgenda(today, result);
      } catch (error) {
        handleError(error);
      }
    }))
  .command("show", new Command()
    .description("Show agenda for a specific date")
    .arguments("<date:string>")
    .action(async (_options, date) => {
      try {
        const result = await callTool<AgendaResponse>("get_agenda", {
          date,
        });

        printAgenda(date, result);
      } catch (error) {
        handleError(error);
      }
    }));

interface AgendaItem {
  id: string;
  title: string;
  category: string;
  scheduled_time?: string;
  duration_minutes?: number;
  status: "pending" | "completed" | "skipped";
  notes?: string;
}

interface AgendaResponse {
  agenda_items: AgendaItem[];
  date: string;
}

function printAgenda(date: string, response: AgendaResponse): void {
  const dateObj = new Date(date);
  const formattedDate = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  console.log(`\nAgenda for ${formattedDate}\n`);

  if (!response.agenda_items || response.agenda_items.length === 0) {
    console.log("  No agenda items for this date.");
    console.log("  Use the LifePrint app to add items to your agenda.");
    return;
  }

  // Group by category
  const categories = new Map<string, AgendaItem[]>();
  for (const item of response.agenda_items) {
    const cat = item.category || "Other";
    if (!categories.has(cat)) {
      categories.set(cat, []);
    }
    categories.get(cat)!.push(item);
  }

  // Category icons
  const categoryIcons: Record<string, string> = {
    meal: "[Meal]",
    movement: "[Move]",
    meditation: "[Mind]",
    task: "[Task]",
    other: "[...]",
  };

  const rows: string[][] = [];
  const headers = ["Time", "Category", "Item", "Status"];

  for (const [category, items] of categories) {
    for (const item of items) {
      const time = item.scheduled_time || "--:--";
      const icon = categoryIcons[category.toLowerCase()] || categoryIcons.other;
      const status = getStatusSymbol(item.status);
      rows.push([time, icon, item.title, status]);
    }
  }

  // Sort by time
  rows.sort((a, b) => {
    if (a[0] === "--:--") return 1;
    if (b[0] === "--:--") return -1;
    return a[0].localeCompare(b[0]);
  });

  const table = new Table()
    .header(headers)
    .body(rows)
    .padding(1)
    .indent(2);

  table.render();

  // Summary
  const completed = response.agenda_items.filter(i => i.status === "completed").length;
  const total = response.agenda_items.length;
  console.log(`\n  Progress: ${completed}/${total} completed`);
  console.log();
}

function getStatusSymbol(status: string): string {
  switch (status) {
    case "completed":
      return "[x]";
    case "skipped":
      return "[-]";
    default:
      return "[ ]";
  }
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
