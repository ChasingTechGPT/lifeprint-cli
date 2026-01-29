/**
 * Meal plan commands
 */

import { Command } from "@cliffy/command";
import { Table } from "@cliffy/table";
import { callTool, AuthRequiredError } from "../../api/client.ts";

export const mealplanCommand = new Command()
  .description("View and manage meal plans")
  .command("week", new Command()
    .description("View meal plan for a week")
    .arguments("[date:string]")
    .action(async (_options, date?: string) => {
      try {
        const startDate = date || new Date().toISOString().split("T")[0];
        const result = await callTool<{ meal_plan: WeekMealPlan }>("get_meal_plan", {
          start_date: startDate,
          days: 7,
        });

        if (!result.meal_plan || !result.meal_plan.days?.length) {
          console.log("No meal plan found for this week.");
          console.log("Use 'lifeprint recipe generate' to create meals.");
          return;
        }

        printWeekMealPlan(result.meal_plan);
      } catch (error) {
        handleError(error);
      }
    }))
  .command("schedule", new Command()
    .description("Show today's meal schedule")
    .action(async () => {
      try {
        const today = new Date().toISOString().split("T")[0];
        const result = await callTool<{ meal_plan: WeekMealPlan }>("get_meal_plan", {
          start_date: today,
          days: 1,
        });

        if (!result.meal_plan || !result.meal_plan.days?.length) {
          console.log("No meals scheduled for today.");
          return;
        }

        const day = result.meal_plan.days[0];
        printDayMeals(day);
      } catch (error) {
        handleError(error);
      }
    }));

interface MealSlot {
  meal_type: string;
  recipe_name?: string;
  scheduled_time?: string;
}

interface DayMealPlan {
  date: string;
  meals: MealSlot[];
}

interface WeekMealPlan {
  days: DayMealPlan[];
}

function printWeekMealPlan(plan: WeekMealPlan): void {
  console.log("\nWeek Meal Plan\n");

  const rows: string[][] = [];
  const headers = ["Day", "Breakfast", "Lunch", "Dinner", "Snacks"];

  for (const day of plan.days) {
    const date = new Date(day.date);
    const dayName = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

    const breakfast = day.meals.find(m => m.meal_type === "breakfast")?.recipe_name || "-";
    const lunch = day.meals.find(m => m.meal_type === "lunch")?.recipe_name || "-";
    const dinner = day.meals.find(m => m.meal_type === "dinner")?.recipe_name || "-";
    const snacks = day.meals
      .filter(m => m.meal_type === "snack")
      .map(m => m.recipe_name)
      .filter(Boolean)
      .join(", ") || "-";

    rows.push([dayName, breakfast, lunch, dinner, snacks]);
  }

  const table = new Table()
    .header(headers)
    .body(rows)
    .padding(1)
    .indent(2);

  table.render();
  console.log();
}

function printDayMeals(day: DayMealPlan): void {
  const date = new Date(day.date);
  const dayName = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  console.log(`\nMeals for ${dayName}\n`);

  const mealOrder = ["breakfast", "snack", "lunch", "snack", "dinner", "snack"];
  const mealLabels: Record<string, string> = {
    breakfast: "Breakfast",
    lunch: "Lunch",
    dinner: "Dinner",
    snack: "Snack",
  };

  const seenSnacks = new Set<string>();

  for (const mealType of mealOrder) {
    const meals = day.meals.filter(m => m.meal_type === mealType);
    for (const meal of meals) {
      const key = `${meal.meal_type}-${meal.recipe_name}`;
      if (mealType === "snack" && seenSnacks.has(key)) continue;
      seenSnacks.add(key);

      const label = mealLabels[meal.meal_type] || meal.meal_type;
      const time = meal.scheduled_time ? ` (${meal.scheduled_time})` : "";
      const name = meal.recipe_name || "Not scheduled";
      console.log(`  ${label}${time}: ${name}`);
    }
  }
  console.log();
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
