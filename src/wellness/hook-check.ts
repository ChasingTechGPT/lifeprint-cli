/**
 * Hook check entry point
 * Called by ~/.lifeprint/hooks/wellness-check.sh via UserPromptSubmit hook
 *
 * Exit codes:
 *   0 = allow prompt (optionally with context injection)
 *   2 = block prompt (stderr shows break message)
 */

import {
  loadWellnessState,
  saveWellnessState,
  isConfigured,
  isBreakActive,
  isBreakCompleteOrExpired,
  isSessionLimitReached,
  isPowerBreakDue,
  triggerBreak,
  resetBreakState,
  resetSession,
  recordPrompt,
  getTimeWorkedFormatted,
  getTimeUntilNextBreak,
  getCooldownRemaining,
  formatMs,
  formatTimeOfDay,
} from "./state.ts";
import type { WellnessState } from "./state.ts";

/**
 * Run the wellness hook check. Called from `lifeprint wellness check`.
 */
export async function runHookCheck(): Promise<void> {
  // Read stdin (Claude Code sends hook JSON, but we don't need it for decisions)
  try {
    const buf = new Uint8Array(65536);
    await Deno.stdin.read(buf);
  } catch {
    // stdin may be closed or empty, that's fine
  }

  const state = await loadWellnessState();

  // Not configured → allow through
  if (!isConfigured(state)) {
    Deno.exit(0);
  }

  // Break is active — check if completed or expired
  if (isBreakActive(state)) {
    if (isBreakCompleteOrExpired(state)) {
      // Break done → reset and allow through
      let newState = resetBreakState(state);
      if (state.currentBreak.type === "session_limit") {
        newState = resetSession(newState);
      }
      await saveWellnessState(newState);
      Deno.exit(0);
    }

    // Break still active → block
    printBlockMessage(state);
    Deno.exit(2);
  }

  // Check if session limit reached
  if (isSessionLimitReached(state)) {
    const newState = triggerBreak(state, "session_limit");
    await saveWellnessState(newState);
    printBlockMessage(newState);
    Deno.exit(2);
  }

  // Check if power break is due
  if (isPowerBreakDue(state)) {
    const newState = triggerBreak(state, "power_break");
    await saveWellnessState(newState);
    printBlockMessage(newState);
    Deno.exit(2);
  }

  // No break needed → record prompt and allow through
  const newState = recordPrompt(state);
  await saveWellnessState(newState);

  // Inject context about session timer
  const context = buildContext(newState);
  if (context) {
    const output = JSON.stringify(context);
    await Deno.stdout.write(new TextEncoder().encode(output));
  }

  Deno.exit(0);
}

function printBlockMessage(state: WellnessState): void {
  const br = state.currentBreak;
  const cooldownRemaining = getCooldownRemaining(state);
  const cooldownFormatted = formatMs(cooldownRemaining);
  const unlockTime = br.cooldownExpiresAt ? formatTimeOfDay(br.cooldownExpiresAt) : "soon";

  if (br.type === "session_limit") {
    const timeWorked = getTimeWorkedFormatted(state);
    const msg = `
══════════════════════════════════════════════════════════════
  WELLNESS BREAK — SESSION LIMIT REACHED
══════════════════════════════════════════════════════════════

  You've been coding for ${timeWorked}. Time to recharge.

  Complete a LifePrint activity to continue:
    - Open the LifePrint app and do a workout, walk, or meditation
    - Or run: lifeprint wellness complete

  Auto-unlock in ${cooldownFormatted} (${unlockTime})

══════════════════════════════════════════════════════════════
`;
    Deno.stderr.writeSync(new TextEncoder().encode(msg));
  } else if (br.type === "power_break") {
    const name = br.activityName ?? "Power Break";
    const instructions = br.activityInstructions ?? [];
    const instructionLines = instructions
      .map((inst, i) => `  ${i + 1}. ${inst}`)
      .join("\n");

    const msg = `
══════════════════════════════════════════════════════════════
  POWER BREAK — ${name}
══════════════════════════════════════════════════════════════

${instructionLines}

  To continue:
    - Complete in the LifePrint app
    - Or run: lifeprint wellness complete

  Auto-unlock in ${cooldownFormatted}

══════════════════════════════════════════════════════════════
`;
    Deno.stderr.writeSync(new TextEncoder().encode(msg));
  }
}

interface HookContextOutput {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
}

function buildContext(state: WellnessState): HookContextOutput | null {
  const parts: string[] = [];
  const timeWorked = getTimeWorkedFormatted(state);

  if (state.session.startedAt) {
    parts.push(`Working for ${timeWorked}`);
  }

  if (state.config.powerBreaks.enabled) {
    const nextBreak = getTimeUntilNextBreak(state);
    if (nextBreak !== null && nextBreak > 0) {
      parts.push(`Next power break in ${formatMs(nextBreak)}`);
    }
  }

  if (parts.length === 0) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `LifePrint: ${parts.join(". ")}.`,
    },
  };
}
