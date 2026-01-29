/**
 * Movement commands
 */

import { Command } from "@cliffy/command";
import { callTool, callToolStreaming, AuthRequiredError } from "../../api/client.ts";

export const movementCommand = new Command()
  .description("Movement flow generation and search")
  .command("generate", new Command()
    .description("Generate a movement flow based on a prompt")
    .arguments("<prompt:string>")
    .option("-d, --duration <minutes:number>", "Target duration in minutes", { default: 30 })
    .option("-l, --level <level:string>", "Difficulty level (beginner, intermediate, advanced)")
    .option("--stream", "Stream the response")
    .action(async (options, prompt) => {
      try {
        const args: Record<string, unknown> = {
          prompt,
          duration_minutes: options.duration,
        };
        if (options.level) {
          args.difficulty_level = options.level;
        }

        if (options.stream) {
          console.log("Generating movement flow...\n");
          for await (const chunk of callToolStreaming("generate_movement_flow", args)) {
            if (chunk.type === "text" && chunk.content) {
              Deno.stdout.writeSync(new TextEncoder().encode(chunk.content));
            } else if (chunk.type === "complete" && chunk.data) {
              console.log("\n\nMovement flow generated successfully.");
            } else if (chunk.type === "error") {
              console.error(`\nError: ${chunk.error}`);
            }
          }
        } else {
          console.log("Generating movement flow...\n");
          const result = await callTool<{ movement_flow: MovementFlow }>("generate_movement_flow", args);
          printMovementFlow(result.movement_flow);
        }
      } catch (error) {
        handleError(error);
      }
    }))
  .command("search", new Command()
    .description("Search for saved movement flows")
    .arguments("[query:string]")
    .option("-l, --limit <limit:number>", "Maximum number of results", { default: 10 })
    .option("-t, --type <type:string>", "Movement type (yoga, strength, cardio, stretch)")
    .action(async (options, query?: string) => {
      try {
        const args: Record<string, unknown> = {
          limit: options.limit,
        };
        if (query) {
          args.query = query;
        }
        if (options.type) {
          args.movement_type = options.type;
        }

        const result = await callTool<{ movement_flows: MovementFlowSummary[] }>("search_movement_flows", args);

        if (!result.movement_flows || result.movement_flows.length === 0) {
          console.log("No movement flows found.");
          return;
        }

        console.log(`Found ${result.movement_flows.length} movement flows:\n`);
        for (const flow of result.movement_flows) {
          console.log(`  - ${flow.name}`);
          const meta: string[] = [];
          if (flow.duration_minutes) meta.push(`${flow.duration_minutes} min`);
          if (flow.difficulty_level) meta.push(flow.difficulty_level);
          if (flow.movement_type) meta.push(flow.movement_type);
          if (meta.length > 0) {
            console.log(`    ${meta.join(" | ")}`);
          }
          if (flow.description) {
            console.log(`    ${flow.description}`);
          }
          console.log();
        }
      } catch (error) {
        handleError(error);
      }
    }));

interface MovementExercise {
  name: string;
  duration_seconds?: number;
  reps?: number;
  sets?: number;
  notes?: string;
}

interface MovementFlow {
  name: string;
  description?: string;
  duration_minutes: number;
  difficulty_level?: string;
  movement_type?: string;
  exercises: MovementExercise[];
  warmup?: MovementExercise[];
  cooldown?: MovementExercise[];
}

interface MovementFlowSummary {
  id: string;
  name: string;
  description?: string;
  duration_minutes?: number;
  difficulty_level?: string;
  movement_type?: string;
}

function printMovementFlow(flow: MovementFlow): void {
  console.log(`=== ${flow.name} ===\n`);
  if (flow.description) {
    console.log(flow.description);
    console.log();
  }

  const meta: string[] = [];
  meta.push(`${flow.duration_minutes} minutes`);
  if (flow.difficulty_level) meta.push(flow.difficulty_level);
  if (flow.movement_type) meta.push(flow.movement_type);
  console.log(meta.join(" | "));
  console.log();

  if (flow.warmup && flow.warmup.length > 0) {
    console.log("Warm-up:");
    printExercises(flow.warmup);
    console.log();
  }

  console.log("Main Workout:");
  printExercises(flow.exercises);
  console.log();

  if (flow.cooldown && flow.cooldown.length > 0) {
    console.log("Cool-down:");
    printExercises(flow.cooldown);
  }
}

function printExercises(exercises: MovementExercise[]): void {
  for (let i = 0; i < exercises.length; i++) {
    const ex = exercises[i];
    let detail = "";
    if (ex.duration_seconds) {
      detail = `${ex.duration_seconds}s`;
    } else if (ex.reps && ex.sets) {
      detail = `${ex.sets}x${ex.reps}`;
    } else if (ex.reps) {
      detail = `${ex.reps} reps`;
    }

    console.log(`  ${i + 1}. ${ex.name}${detail ? ` (${detail})` : ""}`);
    if (ex.notes) {
      console.log(`     ${ex.notes}`);
    }
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
