/**
 * Meditation commands
 */

import { Command } from "@cliffy/command";
import { callTool, callToolStreaming, AuthRequiredError } from "../../api/client.ts";

export const meditationCommand = new Command()
  .description("Meditation session generation and search")
  .command("generate", new Command()
    .description("Generate a meditation session based on a prompt")
    .arguments("<prompt:string>")
    .option("-d, --duration <minutes:number>", "Target duration in minutes", { default: 10 })
    .option("-t, --type <type:string>", "Meditation type (guided, breathing, body-scan, mindfulness)")
    .option("--stream", "Stream the response")
    .action(async (options, prompt) => {
      try {
        const args: Record<string, unknown> = {
          prompt,
          duration_minutes: options.duration,
        };
        if (options.type) {
          args.meditation_type = options.type;
        }

        if (options.stream) {
          console.log("Generating meditation session...\n");
          for await (const chunk of callToolStreaming("generate_meditation", args)) {
            if (chunk.type === "text" && chunk.content) {
              Deno.stdout.writeSync(new TextEncoder().encode(chunk.content));
            } else if (chunk.type === "complete" && chunk.data) {
              console.log("\n\nMeditation session generated successfully.");
            } else if (chunk.type === "error") {
              console.error(`\nError: ${chunk.error}`);
            }
          }
        } else {
          console.log("Generating meditation session...\n");
          const result = await callTool<{ meditation: MeditationSession }>("generate_meditation", args);
          printMeditation(result.meditation);
        }
      } catch (error) {
        handleError(error);
      }
    }))
  .command("search", new Command()
    .description("Search for saved meditation sessions")
    .arguments("[query:string]")
    .option("-l, --limit <limit:number>", "Maximum number of results", { default: 10 })
    .option("-t, --type <type:string>", "Meditation type filter")
    .action(async (options, query?: string) => {
      try {
        const args: Record<string, unknown> = {
          limit: options.limit,
        };
        if (query) {
          args.query = query;
        }
        if (options.type) {
          args.meditation_type = options.type;
        }

        const result = await callTool<{ meditations: MeditationSummary[] }>("search_meditations", args);

        if (!result.meditations || result.meditations.length === 0) {
          console.log("No meditation sessions found.");
          return;
        }

        console.log(`Found ${result.meditations.length} meditation sessions:\n`);
        for (const med of result.meditations) {
          console.log(`  - ${med.name}`);
          const meta: string[] = [];
          if (med.duration_minutes) meta.push(`${med.duration_minutes} min`);
          if (med.meditation_type) meta.push(med.meditation_type);
          if (meta.length > 0) {
            console.log(`    ${meta.join(" | ")}`);
          }
          if (med.description) {
            console.log(`    ${med.description}`);
          }
          console.log();
        }
      } catch (error) {
        handleError(error);
      }
    }));

interface MeditationSegment {
  name: string;
  duration_seconds: number;
  instructions?: string;
}

interface MeditationSession {
  name: string;
  description?: string;
  duration_minutes: number;
  meditation_type?: string;
  segments: MeditationSegment[];
  intro?: string;
  closing?: string;
}

interface MeditationSummary {
  id: string;
  name: string;
  description?: string;
  duration_minutes?: number;
  meditation_type?: string;
}

function printMeditation(meditation: MeditationSession): void {
  console.log(`=== ${meditation.name} ===\n`);
  if (meditation.description) {
    console.log(meditation.description);
    console.log();
  }

  const meta: string[] = [];
  meta.push(`${meditation.duration_minutes} minutes`);
  if (meditation.meditation_type) meta.push(meditation.meditation_type);
  console.log(meta.join(" | "));
  console.log();

  if (meditation.intro) {
    console.log("Introduction:");
    console.log(`  ${meditation.intro}`);
    console.log();
  }

  console.log("Session Flow:");
  for (let i = 0; i < meditation.segments.length; i++) {
    const seg = meditation.segments[i];
    const minutes = Math.floor(seg.duration_seconds / 60);
    const seconds = seg.duration_seconds % 60;
    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    console.log(`  ${i + 1}. ${seg.name} (${timeStr})`);
    if (seg.instructions) {
      console.log(`     ${seg.instructions}`);
    }
  }
  console.log();

  if (meditation.closing) {
    console.log("Closing:");
    console.log(`  ${meditation.closing}`);
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
