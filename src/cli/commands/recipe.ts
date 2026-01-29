/**
 * Recipe commands
 */

import { Command } from "@cliffy/command";
import { callTool, callToolStreaming, AuthRequiredError } from "../../api/client.ts";

export const recipeCommand = new Command()
  .description("Recipe generation and search")
  .command("generate", new Command()
    .description("Generate a recipe based on a prompt")
    .arguments("<prompt:string>")
    .option("-s, --servings <servings:number>", "Number of servings", { default: 2 })
    .option("--stream", "Stream the response")
    .action(async (options, prompt) => {
      try {
        if (options.stream) {
          console.log("Generating recipe...\n");
          for await (const chunk of callToolStreaming("generate_recipe", {
            prompt,
            servings: options.servings,
          })) {
            if (chunk.type === "text" && chunk.content) {
              Deno.stdout.writeSync(new TextEncoder().encode(chunk.content));
            } else if (chunk.type === "complete" && chunk.data) {
              console.log("\n\nRecipe generated successfully.");
            } else if (chunk.type === "error") {
              console.error(`\nError: ${chunk.error}`);
            }
          }
        } else {
          console.log("Generating recipe...\n");
          const result = await callTool<{ recipe: RecipeData }>("generate_recipe", {
            prompt,
            servings: options.servings,
          });
          printRecipe(result.recipe);
        }
      } catch (error) {
        handleError(error);
      }
    }))
  .command("search", new Command()
    .description("Search for saved recipes")
    .arguments("<query:string>")
    .option("-l, --limit <limit:number>", "Maximum number of results", { default: 10 })
    .action(async (options, query) => {
      try {
        const result = await callTool<{ recipes: RecipeSummary[] }>("search_recipes", {
          query,
          limit: options.limit,
        });

        if (!result.recipes || result.recipes.length === 0) {
          console.log("No recipes found.");
          return;
        }

        console.log(`Found ${result.recipes.length} recipes:\n`);
        for (const recipe of result.recipes) {
          console.log(`  - ${recipe.name}`);
          if (recipe.description) {
            console.log(`    ${recipe.description}`);
          }
          console.log();
        }
      } catch (error) {
        handleError(error);
      }
    }));

interface RecipeData {
  name: string;
  description?: string;
  servings: number;
  prep_time_minutes?: number;
  cook_time_minutes?: number;
  ingredients: { item: string; amount: string; unit?: string }[];
  instructions: string[];
}

interface RecipeSummary {
  id: string;
  name: string;
  description?: string;
}

function printRecipe(recipe: RecipeData): void {
  console.log(`=== ${recipe.name} ===\n`);
  if (recipe.description) {
    console.log(recipe.description);
    console.log();
  }

  console.log(`Servings: ${recipe.servings}`);
  if (recipe.prep_time_minutes) {
    console.log(`Prep Time: ${recipe.prep_time_minutes} minutes`);
  }
  if (recipe.cook_time_minutes) {
    console.log(`Cook Time: ${recipe.cook_time_minutes} minutes`);
  }
  console.log();

  console.log("Ingredients:");
  for (const ing of recipe.ingredients) {
    const unit = ing.unit ? ` ${ing.unit}` : "";
    console.log(`  - ${ing.amount}${unit} ${ing.item}`);
  }
  console.log();

  console.log("Instructions:");
  recipe.instructions.forEach((step, i) => {
    console.log(`  ${i + 1}. ${step}`);
  });
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
