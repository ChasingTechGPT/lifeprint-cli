/**
 * Curated power break activity library
 * Offline-capable, no AI generation needed
 */

export interface PowerBreakActivity {
  id: string;
  name: string;
  durationSeconds: number;
  category: "breathing" | "movement" | "stretch" | "hydration" | "eyes";
  instructions: string[];
}

export const POWER_BREAK_ACTIVITIES: PowerBreakActivity[] = [
  // Breathing
  {
    id: "box-breathing",
    name: "Box Breathing (2 min)",
    durationSeconds: 120,
    category: "breathing",
    instructions: [
      "Breathe in for 4 seconds",
      "Hold for 4 seconds",
      "Breathe out for 4 seconds",
      "Hold for 4 seconds",
      "Repeat 8 times",
    ],
  },
  {
    id: "478-breathing",
    name: "4-7-8 Breathing",
    durationSeconds: 90,
    category: "breathing",
    instructions: [
      "Breathe in through nose for 4 seconds",
      "Hold breath for 7 seconds",
      "Exhale through mouth for 8 seconds",
      "Repeat 4 times",
    ],
  },
  {
    id: "deep-belly-breaths",
    name: "Deep Belly Breaths",
    durationSeconds: 60,
    category: "breathing",
    instructions: [
      "Place one hand on your chest, one on your belly",
      "Breathe deeply so only your belly hand moves",
      "Inhale for 5 seconds, exhale for 5 seconds",
      "Repeat 6 times",
    ],
  },
  {
    id: "physiological-sigh",
    name: "Physiological Sigh",
    durationSeconds: 60,
    category: "breathing",
    instructions: [
      "Double inhale through nose (two quick breaths in)",
      "Long slow exhale through mouth",
      "This is the fastest way to calm your nervous system",
      "Repeat 5 times",
    ],
  },

  // Movement
  {
    id: "pushups-25",
    name: "25 Pushups",
    durationSeconds: 90,
    category: "movement",
    instructions: [
      "Drop and give yourself 25 pushups",
      "Modify to knee pushups if needed",
      "Focus on full range of motion",
      "Rest 5 seconds between sets of 10 if needed",
    ],
  },
  {
    id: "jumping-jacks-100",
    name: "100 Jumping Jacks",
    durationSeconds: 120,
    category: "movement",
    instructions: [
      "Do 100 jumping jacks at a steady pace",
      "Focus on full arm extension overhead",
      "Land softly on the balls of your feet",
      "Break into sets of 25 if needed",
    ],
  },
  {
    id: "squats-30",
    name: "30 Bodyweight Squats",
    durationSeconds: 120,
    category: "movement",
    instructions: [
      "Stand with feet shoulder-width apart",
      "Squat down until thighs are parallel to floor",
      "Keep chest up and weight in heels",
      "Do 30 reps at a controlled pace",
    ],
  },
  {
    id: "burpee-challenge",
    name: "10 Burpees",
    durationSeconds: 120,
    category: "movement",
    instructions: [
      "Start standing, drop to plank position",
      "Do a pushup, jump feet forward",
      "Jump up with arms overhead",
      "10 reps — go at your own pace",
    ],
  },
  {
    id: "wall-sit",
    name: "Wall Sit Challenge",
    durationSeconds: 90,
    category: "movement",
    instructions: [
      "Find a wall and slide your back down",
      "Thighs parallel to the ground, knees at 90 degrees",
      "Hold for 60 seconds",
      "Rest 10 seconds, then hold for 30 more",
    ],
  },
  {
    id: "stair-climb",
    name: "Stair Sprint",
    durationSeconds: 120,
    category: "movement",
    instructions: [
      "Find a flight of stairs",
      "Walk or jog up and down 5 times",
      "Take two stairs at a time on the way up",
      "Walk down carefully at normal pace",
    ],
  },

  // Stretch
  {
    id: "full-body-stretch",
    name: "5 Min Full Body Stretch",
    durationSeconds: 300,
    category: "stretch",
    instructions: [
      "Neck rolls: 30 seconds each direction",
      "Shoulder shrugs and arm circles: 30 seconds",
      "Standing forward fold: 45 seconds",
      "Quad stretch each leg: 30 seconds each",
      "Hip circles: 30 seconds each direction",
      "Wrist circles and finger stretches: 30 seconds",
    ],
  },
  {
    id: "neck-shoulders",
    name: "Neck & Shoulder Release",
    durationSeconds: 120,
    category: "stretch",
    instructions: [
      "Tilt head to right ear toward shoulder, hold 15 sec",
      "Repeat on left side",
      "Roll shoulders forward 10 times, backward 10 times",
      "Clasp hands behind back, open chest, hold 20 sec",
      "Cross right arm over chest, hold 15 sec, switch",
    ],
  },
  {
    id: "hip-flexor-stretch",
    name: "Hip Flexor Stretch",
    durationSeconds: 120,
    category: "stretch",
    instructions: [
      "Kneel on right knee, left foot forward",
      "Push hips forward gently, feel stretch in right hip",
      "Hold 45 seconds",
      "Switch sides and repeat",
    ],
  },
  {
    id: "seated-twist",
    name: "Seated Spinal Twist",
    durationSeconds: 90,
    category: "stretch",
    instructions: [
      "Sit tall in your chair",
      "Cross right leg over left",
      "Twist torso to the right, hold 30 seconds",
      "Switch legs and twist left, hold 30 seconds",
    ],
  },

  // Hydration
  {
    id: "water-walk",
    name: "Water Walk",
    durationSeconds: 120,
    category: "hydration",
    instructions: [
      "Stand up and walk to get a glass of water",
      "Drink the full glass slowly",
      "Take a few deep breaths while standing",
      "Walk back when ready",
    ],
  },
  {
    id: "tea-break",
    name: "Make Tea or Coffee",
    durationSeconds: 300,
    category: "hydration",
    instructions: [
      "Step away from your desk completely",
      "Make yourself a cup of tea or coffee",
      "Stand while it brews — no phone",
      "Take 3 deep breaths before returning",
    ],
  },

  // Eyes
  {
    id: "20-20-20",
    name: "20-20-20 Rule",
    durationSeconds: 60,
    category: "eyes",
    instructions: [
      "Look at something 20 feet away",
      "Focus on it for 20 seconds",
      "Blink 20 times slowly",
      "Close eyes and rest for 10 seconds",
    ],
  },
  {
    id: "eye-circles",
    name: "Eye Circles",
    durationSeconds: 60,
    category: "eyes",
    instructions: [
      "Close your eyes",
      "Roll eyes clockwise slowly 10 times",
      "Roll eyes counter-clockwise 10 times",
      "Open eyes and focus on a distant point",
      "Blink rapidly 10 times",
    ],
  },
  {
    id: "palming",
    name: "Eye Palming",
    durationSeconds: 90,
    category: "eyes",
    instructions: [
      "Rub palms together vigorously for 10 seconds",
      "Cup warm palms gently over closed eyes",
      "Don't press on eyeballs — just cover them",
      "Breathe deeply for 60 seconds in darkness",
      "Slowly remove hands and open eyes",
    ],
  },
  {
    id: "distance-focus",
    name: "Distance Focus Drill",
    durationSeconds: 60,
    category: "eyes",
    instructions: [
      "Hold thumb 10 inches from face, focus on it",
      "Look at something 20+ feet away",
      "Alternate focus every 3 seconds",
      "Repeat 10 times",
    ],
  },
];

/**
 * Select a random activity, avoiding recently used ones
 */
export function selectRandomActivity(
  recentIds: string[] = [],
): PowerBreakActivity {
  // Filter out recently used activities
  const available = POWER_BREAK_ACTIVITIES.filter(
    (a) => !recentIds.includes(a.id),
  );

  // If all have been used recently, use the full list
  const pool = available.length > 0 ? available : POWER_BREAK_ACTIVITIES;

  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}

/**
 * Get activities by category
 */
export function getActivitiesByCategory(
  category: PowerBreakActivity["category"],
): PowerBreakActivity[] {
  return POWER_BREAK_ACTIVITIES.filter((a) => a.category === category);
}
