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
  isSessionIdle,
  hasBreakToProcess,
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
import { fetchBreakContent } from "./break-content.ts";
import { openBrowser } from "../utils/browser.ts";
import { evaluateContext, isContextSyncDue } from "./context-evaluator.ts";
import { syncWellnessContext } from "./context-sync.ts";

/**
 * Commands that should bypass the wellness check entirely.
 * This prevents the "Catch-22" where users can't run `lifeprint wellness complete`
 * because the hook blocks their prompt.
 */
const BYPASS_PATTERNS = [
  /lifeprint\s+wellness/i,
  /lifeprint\s+status/i,
  /lifeprint\s+--help/i,
  /lifeprint\s+-h/i,
];

/**
 * Check if a prompt should bypass wellness enforcement.
 */
function shouldBypass(promptText: string): boolean {
  return BYPASS_PATTERNS.some((pattern) => pattern.test(promptText));
}

/**
 * Parse the user's prompt from Claude Code hook input (JSON on stdin).
 */
function parsePromptFromStdin(stdinContent: string): string {
  try {
    const data = JSON.parse(stdinContent);
    // Claude Code sends: { prompt: "user's message" }
    return data?.prompt ?? "";
  } catch {
    // Not valid JSON, return raw content
    return stdinContent;
  }
}

/**
 * Run the wellness hook check. Called from `lifeprint wellness check`.
 */
export async function runHookCheck(): Promise<void> {
  // Read stdin (Claude Code sends hook JSON with the user's prompt)
  let stdinContent = "";
  try {
    const buf = new Uint8Array(65536);
    const n = await Deno.stdin.read(buf);
    if (n !== null) {
      stdinContent = new TextDecoder().decode(buf.subarray(0, n));
    }
  } catch {
    // stdin may be closed or empty, that's fine
  }

  // Check if the prompt should bypass wellness enforcement entirely
  const promptText = parsePromptFromStdin(stdinContent);
  if (shouldBypass(promptText)) {
    Deno.exit(0);
  }

  let state = await loadWellnessState();

  // Not configured → allow through
  if (!isConfigured(state)) {
    Deno.exit(0);
  }

  // Auto-reset idle sessions BEFORE checking limits
  // This prevents false positives when users leave terminals open overnight
  if (isSessionIdle(state) && !hasBreakToProcess(state)) {
    state = resetSession(state);
    await saveWellnessState(state);
  }

  // Background context sync (fire-and-forget, non-blocking with 2s timeout)
  if (isContextSyncDue(state)) {
    syncWellnessContext(state).catch(() => {
      // Sync failure is non-critical
    });
  }

  // Check if there's a break to process (active, completed, or expired)
  // Using hasBreakToProcess instead of isBreakActive ensures we handle
  // completed breaks correctly instead of skipping to trigger a new one
  if (hasBreakToProcess(state)) {
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

  // Context-aware break evaluation (zero I/O, uses cached schedule)
  const contextEval = evaluateContext(state, promptText);
  if (contextEval.decision === "BREAK_NOW" && contextEval.scheduledBreak) {
    const sb = contextEval.scheduledBreak;
    const apiContent = await fetchBreakContent("power_break", state.powerBreak.recentActivityIds);
    const newState = triggerBreak(state, "power_break", apiContent);
    await saveWellnessState(newState);
    printBlockMessage(newState);
    openBreakPage(newState);
    Deno.exit(2);
  }

  // Check if session limit reached
  if (isSessionLimitReached(state)) {
    const apiContent = await fetchBreakContent("session_limit", state.powerBreak.recentActivityIds);
    const newState = triggerBreak(state, "session_limit", apiContent);
    await saveWellnessState(newState);
    printBlockMessage(newState);
    openBreakPage(newState);
    Deno.exit(2);
  }

  // Check if power break is due
  if (isPowerBreakDue(state)) {
    const apiContent = await fetchBreakContent("power_break", state.powerBreak.recentActivityIds);
    const newState = triggerBreak(state, "power_break", apiContent);
    await saveWellnessState(newState);
    printBlockMessage(newState);
    openBreakPage(newState);
    Deno.exit(2);
  }

  // No break needed → record prompt and allow through
  const newState = recordPrompt(state);
  await saveWellnessState(newState);

  // Inject context about session timer (includes BREAK_SOON/SUGGEST nudges)
  const context = buildContext(newState, contextEval);
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

  const deepLink = br.deepLinkUrl;
  const deepLinkLine = deepLink ? `\n  Open in app: ${deepLink}\n` : "";
  const notifNote = br.suggestionId
    ? "  (A push notification has been sent to your device)\n"
    : "";

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
${notifNote}${deepLinkLine}
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
${notifNote}${deepLinkLine}
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

/**
 * Build the URL for the wellness break web page.
 * All display data travels via query params so the page needs no API call.
 */
function buildBreakWebUrl(state: WellnessState): string {
  const br = state.currentBreak;
  const params = new URLSearchParams();

  if (br.suggestionId) params.set("suggestion_id", br.suggestionId);
  if (br.type) params.set("break_type", br.type);
  if (br.contentType) params.set("content_type", br.contentType);
  if (br.activityName) params.set("name", br.activityName);
  if (br.cooldownExpiresAt) params.set("cooldown_expires", br.cooldownExpiresAt);

  return `https://lifeprintpro.com/wellness/break?${params.toString()}`;
}

/**
 * Fire-and-forget: open the wellness break web page in the browser.
 * Only called when a break is first triggered, not on re-blocks.
 */
function openBreakPage(state: WellnessState): void {
  try {
    const url = buildBreakWebUrl(state);
    openBrowser(url).catch(() => {
      // Browser open failed silently - user still sees terminal message
    });
  } catch {
    // Ignore errors - the terminal message is the primary UX
  }
}

function buildContext(
  state: WellnessState,
  contextEval?: { decision: string; message?: string },
): HookContextOutput | null {
  const parts: string[] = [];
  const timeWorked = getTimeWorkedFormatted(state);

  if (state.session.startedAt) {
    parts.push(`Working for ${timeWorked}`);
  }

  // Include BREAK_SOON or SUGGEST nudge as non-blocking context
  if (contextEval && (contextEval.decision === "BREAK_SOON" || contextEval.decision === "SUGGEST") && contextEval.message) {
    parts.push(contextEval.message);
  } else if (state.config.powerBreaks.enabled) {
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
