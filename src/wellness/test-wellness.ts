/**
 * Wellness system integration test
 * Run: deno run --allow-read --allow-write --allow-env src/wellness/test-wellness.ts
 */

import {
  loadWellnessState,
  saveWellnessState,
  createDefaultState,
  isConfigured,
  isSessionLimitReached,
  isPowerBreakDue,
  isBreakActive,
  isBreakCompleteOrExpired,
  triggerBreak,
  completeBreak,
  resetBreakState,
  resetSession,
  recordPrompt,
  getTimeWorkedMs,
  getTimeWorkedFormatted,
  getTimeUntilNextBreak,
  getCooldownRemaining,
  formatMs,
  getWellnessPath,
} from "./state.ts";
import {
  POWER_BREAK_ACTIVITIES,
  selectRandomActivity,
  getActivitiesByCategory,
} from "./activities.ts";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  \x1b[32mPASS\x1b[0m  ${label}`);
    passed++;
  } else {
    console.log(`  \x1b[31mFAIL\x1b[0m  ${label}`);
    failed++;
  }
}

// --- Test Suite ---

console.log("\n\x1b[1m=== LifePrint Wellness System Tests ===\x1b[0m\n");

// ---- 1. Default State ----
console.log("\x1b[1m1. Default State\x1b[0m");
{
  const state = createDefaultState();
  assert(state.version === 1, "Version is 1");
  assert(!state.config.sessionLimit.enabled, "Session limit disabled by default");
  assert(!state.config.powerBreaks.enabled, "Power breaks disabled by default");
  assert(!isConfigured(state), "Not configured by default");
  assert(state.session.promptCount === 0, "Prompt count starts at 0");
  assert(state.currentBreak.type === null, "No active break");
}

// ---- 2. Activities Library ----
console.log("\n\x1b[1m2. Activities Library\x1b[0m");
{
  assert(POWER_BREAK_ACTIVITIES.length >= 20, `Has ${POWER_BREAK_ACTIVITIES.length} activities (>= 20)`);

  const categories = new Set(POWER_BREAK_ACTIVITIES.map((a) => a.category));
  assert(categories.has("breathing"), "Has breathing activities");
  assert(categories.has("movement"), "Has movement activities");
  assert(categories.has("stretch"), "Has stretch activities");
  assert(categories.has("hydration"), "Has hydration activities");
  assert(categories.has("eyes"), "Has eyes activities");

  // All activities have required fields
  const allValid = POWER_BREAK_ACTIVITIES.every(
    (a) => a.id && a.name && a.durationSeconds > 0 && a.instructions.length > 0,
  );
  assert(allValid, "All activities have required fields");

  // Random selection works
  const activity = selectRandomActivity([]);
  assert(!!activity, `Random activity selected: ${activity.name}`);

  // Avoids recent
  const allIds = POWER_BREAK_ACTIVITIES.map((a) => a.id);
  const allButOne = allIds.slice(0, -1);
  const forced = selectRandomActivity(allButOne);
  assert(!!forced, `Selection with most excluded: ${forced.name}`);

  // Category filter
  const breathing = getActivitiesByCategory("breathing");
  assert(breathing.length >= 3, `Breathing activities: ${breathing.length}`);
}

// ---- 3. Session Tracking ----
console.log("\n\x1b[1m3. Session Tracking\x1b[0m");
{
  let state = createDefaultState();

  // Record a prompt (should initialize session)
  state = recordPrompt(state);
  assert(state.session.startedAt !== null, "Session started after first prompt");
  assert(state.session.promptCount === 1, "Prompt count is 1");
  assert(state.session.lastPromptAt !== null, "Last prompt recorded");

  // Record more prompts
  state = recordPrompt(state);
  state = recordPrompt(state);
  assert(state.session.promptCount === 3, "Prompt count is 3 after 3 prompts");

  // Time worked
  const worked = getTimeWorkedMs(state);
  assert(worked >= 0 && worked < 1000, `Time worked ~0ms: ${worked}ms`);

  const formatted = getTimeWorkedFormatted(state);
  assert(formatted === "0m", `Formatted time: "${formatted}"`);
}

// ---- 4. Session Limit ----
console.log("\n\x1b[1m4. Session Limit Detection\x1b[0m");
{
  let state = createDefaultState();
  state.config.sessionLimit.enabled = true;
  state.config.sessionLimit.durationMinutes = 120;
  state.config.sessionLimit.cooldownMinutes = 30;

  assert(isConfigured(state), "Configured when session limit enabled");

  // Not reached when no session
  assert(!isSessionLimitReached(state), "Not reached without session");

  // Start session just now
  state = recordPrompt(state);
  assert(!isSessionLimitReached(state), "Not reached immediately after start");

  // Simulate session started 3 hours ago
  state.session.startedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  assert(isSessionLimitReached(state), "Reached after 3h (limit is 2h)");

  // Simulate session started 1 hour ago
  state.session.startedAt = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
  assert(!isSessionLimitReached(state), "Not reached after 1h (limit is 2h)");
}

// ---- 5. Power Break Detection ----
console.log("\n\x1b[1m5. Power Break Detection\x1b[0m");
{
  let state = createDefaultState();
  state.config.powerBreaks.enabled = true;
  state.config.powerBreaks.intervalMinutes = 45;

  // Not due without session
  assert(!isPowerBreakDue(state), "Not due without session");

  // Start session just now
  state = recordPrompt(state);
  assert(!isPowerBreakDue(state), "Not due immediately after start");

  // Simulate session started 50 min ago (no breaks taken)
  state.session.startedAt = new Date(Date.now() - 50 * 60 * 1000).toISOString();
  assert(isPowerBreakDue(state), "Due after 50m (interval is 45m)");

  // Simulate last break was 10 min ago
  state.powerBreak.lastBreakAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  assert(!isPowerBreakDue(state), "Not due 10m after last break");

  // Simulate last break was 50 min ago
  state.powerBreak.lastBreakAt = new Date(Date.now() - 50 * 60 * 1000).toISOString();
  assert(isPowerBreakDue(state), "Due 50m after last break");

  // Time until next break
  state.powerBreak.lastBreakAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const remaining = getTimeUntilNextBreak(state);
  assert(remaining !== null && remaining > 0, `Next break in: ${formatMs(remaining!)}`);
}

// ---- 6. Trigger Break ----
console.log("\n\x1b[1m6. Trigger Break\x1b[0m");
{
  let state = createDefaultState();
  state.config.sessionLimit.enabled = true;
  state.config.sessionLimit.durationMinutes = 120;
  state.config.sessionLimit.cooldownMinutes = 30;
  state = recordPrompt(state);

  // Trigger session limit break
  state = triggerBreak(state, "session_limit");
  assert(state.currentBreak.type === "session_limit", "Break type is session_limit");
  assert(state.currentBreak.triggeredAt !== null, "Trigger time recorded");
  assert(state.currentBreak.cooldownExpiresAt !== null, "Cooldown expiry set");
  assert(state.currentBreak.completedAt === null, "Not completed yet");
  assert(isBreakActive(state), "Break is active");
  assert(!isBreakCompleteOrExpired(state), "Break not complete/expired");

  const cooldown = getCooldownRemaining(state);
  assert(cooldown > 0, `Cooldown remaining: ${formatMs(cooldown)}`);

  // Trigger power break
  let state2 = createDefaultState();
  state2.config.powerBreaks.enabled = true;
  state2.config.powerBreaks.intervalMinutes = 45;
  state2 = recordPrompt(state2);
  state2 = triggerBreak(state2, "power_break");
  assert(state2.currentBreak.type === "power_break", "Break type is power_break");
  assert(state2.currentBreak.activityName !== null, `Activity assigned: ${state2.currentBreak.activityName}`);
  assert(state2.currentBreak.activityInstructions !== null, "Instructions assigned");
  assert(
    state2.currentBreak.activityInstructions!.length > 0,
    `Has ${state2.currentBreak.activityInstructions!.length} instruction steps`,
  );
}

// ---- 7. Complete Break ----
console.log("\n\x1b[1m7. Complete Break\x1b[0m");
{
  let state = createDefaultState();
  state.config.powerBreaks.enabled = true;
  state.config.powerBreaks.intervalMinutes = 45;
  state = recordPrompt(state);
  state = triggerBreak(state, "power_break");

  assert(isBreakActive(state), "Break active before completion");

  state = completeBreak(state);
  assert(state.currentBreak.completedAt !== null, "Completed timestamp set");
  assert(isBreakCompleteOrExpired(state), "Break is now complete");
  assert(state.powerBreak.completedToday === 1, "Today's count incremented");
  assert(state.sync.pendingCompletions.length === 1, "Pending sync has 1 completion");
}

// ---- 8. Cooldown Expiry ----
console.log("\n\x1b[1m8. Cooldown Expiry\x1b[0m");
{
  let state = createDefaultState();
  state.config.sessionLimit.enabled = true;
  state.config.sessionLimit.durationMinutes = 120;
  state.config.sessionLimit.cooldownMinutes = 30;
  state = recordPrompt(state);
  state = triggerBreak(state, "session_limit");

  // Simulate cooldown already expired
  state.currentBreak.cooldownExpiresAt = new Date(Date.now() - 1000).toISOString();
  assert(isBreakCompleteOrExpired(state), "Break expired via cooldown");

  // Simulate cooldown not yet expired
  state.currentBreak.cooldownExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  assert(!isBreakCompleteOrExpired(state), "Break not expired yet (10m remaining)");
}

// ---- 9. Reset Session ----
console.log("\n\x1b[1m9. Reset Session\x1b[0m");
{
  let state = createDefaultState();
  state = recordPrompt(state);
  state = recordPrompt(state);
  state = recordPrompt(state);
  state = triggerBreak(state, "session_limit");
  state = completeBreak(state);

  state = resetSession(state);
  assert(state.session.startedAt !== null, "New session started");
  assert(state.session.promptCount === 0, "Prompt count reset");
  assert(state.currentBreak.type === null, "Break cleared");
}

// ---- 10. Reset Break State ----
console.log("\n\x1b[1m10. Reset Break State\x1b[0m");
{
  let state = createDefaultState();
  state = recordPrompt(state);
  state = triggerBreak(state, "power_break");

  state = resetBreakState(state);
  assert(state.currentBreak.type === null, "Break type cleared");
  assert(state.currentBreak.triggeredAt === null, "Trigger time cleared");
  assert(state.currentBreak.activityName === null, "Activity cleared");
  assert(state.session.startedAt !== null, "Session preserved");
  assert(state.session.promptCount === 1, "Prompt count preserved");
}

// ---- 11. File I/O ----
console.log("\n\x1b[1m11. File I/O (Save & Load)\x1b[0m");
{
  const path = getWellnessPath();
  console.log(`  \x1b[2mPath: ${path}\x1b[0m`);

  let state = createDefaultState();
  state.config.sessionLimit.enabled = true;
  state.config.sessionLimit.durationMinutes = 180;
  state.config.powerBreaks.enabled = true;
  state.config.powerBreaks.intervalMinutes = 30;
  state = recordPrompt(state);

  await saveWellnessState(state);
  const loaded = await loadWellnessState();

  assert(loaded.version === 1, "Loaded version is 1");
  assert(loaded.config.sessionLimit.enabled === true, "Session limit persisted");
  assert(loaded.config.sessionLimit.durationMinutes === 180, "Duration persisted");
  assert(loaded.config.powerBreaks.enabled === true, "Power breaks persisted");
  assert(loaded.config.powerBreaks.intervalMinutes === 30, "Interval persisted");
  assert(loaded.session.promptCount === 1, "Prompt count persisted");
  assert(loaded.session.startedAt !== null, "Session start persisted");

  // Clean up — restore to default so we don't affect real state
  await saveWellnessState(createDefaultState());
  const cleaned = await loadWellnessState();
  assert(!isConfigured(cleaned), "Cleaned up to default state");
}

// ---- 12. Full Break Cycle Simulation ----
console.log("\n\x1b[1m12. Full Break Cycle (End-to-End)\x1b[0m");
{
  // Simulate: user codes for 2+ hours → session limit → completes break → resumes
  let state = createDefaultState();
  state.config.sessionLimit.enabled = true;
  state.config.sessionLimit.durationMinutes = 120;
  state.config.sessionLimit.cooldownMinutes = 15;
  state.config.powerBreaks.enabled = true;
  state.config.powerBreaks.intervalMinutes = 45;

  // User starts coding
  state = recordPrompt(state);
  assert(!isSessionLimitReached(state), "Cycle: session just started");
  assert(!isPowerBreakDue(state), "Cycle: no power break yet");

  // Simulate 50 min in (power break due)
  state.session.startedAt = new Date(Date.now() - 50 * 60 * 1000).toISOString();
  assert(!isSessionLimitReached(state), "Cycle: 50m, no session limit");
  assert(isPowerBreakDue(state), "Cycle: 50m, power break due");

  // Trigger power break
  state = triggerBreak(state, "power_break");
  assert(isBreakActive(state), "Cycle: power break active");
  const actName = state.currentBreak.activityName;
  assert(actName !== null, `Cycle: activity = ${actName}`);

  // Complete power break
  state = completeBreak(state);
  assert(isBreakCompleteOrExpired(state), "Cycle: power break completed");
  state = resetBreakState(state);
  assert(!isBreakActive(state), "Cycle: break cleared after reset");

  // Continue coding... simulate 2.5 hours total
  state.session.startedAt = new Date(Date.now() - 150 * 60 * 1000).toISOString();
  state.powerBreak.lastBreakAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  assert(isSessionLimitReached(state), "Cycle: 2.5h, session limit reached");
  assert(!isPowerBreakDue(state), "Cycle: recent power break, not due");

  // Trigger session limit break
  state = triggerBreak(state, "session_limit");
  assert(state.currentBreak.type === "session_limit", "Cycle: session limit break");

  // Simulate cooldown expiry (user didn't complete, just waited)
  state.currentBreak.cooldownExpiresAt = new Date(Date.now() - 1000).toISOString();
  assert(isBreakCompleteOrExpired(state), "Cycle: cooldown expired");

  // Reset and start fresh session
  state = resetBreakState(state);
  state = resetSession(state);
  assert(!isBreakActive(state), "Cycle: fresh after reset");
  assert(state.session.promptCount === 0, "Cycle: prompt count reset");
  assert(state.session.startedAt !== null, "Cycle: new session started");

  console.log("  \x1b[32mFull cycle completed successfully\x1b[0m");
}

// ---- 13. formatMs ----
console.log("\n\x1b[1m13. Formatting\x1b[0m");
{
  assert(formatMs(0) === "0 minutes", `formatMs(0) = "${formatMs(0)}"`);
  assert(formatMs(5 * 60 * 1000) === "5 minutes", `formatMs(5m) = "${formatMs(5 * 60 * 1000)}"`);
  assert(formatMs(90 * 60 * 1000) === "1h 30m", `formatMs(90m) = "${formatMs(90 * 60 * 1000)}"`);
  assert(formatMs(120 * 60 * 1000) === "2h 0m", `formatMs(120m) = "${formatMs(120 * 60 * 1000)}"`);
}

// ---- Summary ----
console.log("\n\x1b[1m════════════════════════════════════════\x1b[0m");
console.log(`  \x1b[32m${passed} passed\x1b[0m, \x1b[${failed > 0 ? "31" : "2"}m${failed} failed\x1b[0m`);
console.log(`\x1b[1m════════════════════════════════════════\x1b[0m\n`);

if (failed > 0) {
  Deno.exit(1);
}
