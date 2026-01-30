/**
 * Context-aware break decision engine.
 * Evaluates scheduled breaks + user context locally with zero I/O.
 */

import type { WellnessState, ScheduledBreak } from "./state.ts";

// --- Decision Types ---

export type BreakDecision = "ALLOW" | "BREAK_NOW" | "BREAK_SOON" | "SUGGEST";

export interface BreakEvaluation {
  decision: BreakDecision;
  scheduledBreak?: ScheduledBreak;
  message?: string;
}

// --- Natural Stopping Point Detection ---

const STOPPING_PATTERNS = [
  /\bwrapping up\b/i,
  /\bone more\b/i,
  /\bfinish(ing|ed)?\s+(up|this)\b/i,
  /\blast\s+(thing|task)\b/i,
  /\bthat('s| is)\s+(it|all)\b/i,
  /\bcommit\s+(and|then)\b/i,
  /\bship\s+(it|this)\b/i,
];

export function isNaturalStoppingPoint(promptText: string): boolean {
  return STOPPING_PATTERNS.some((pattern) => pattern.test(promptText));
}

// --- Time Helpers ---

/**
 * Parse a "HH:MM" time string into today's Date in local time.
 */
function parseTimeToday(timeStr: string): Date {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const now = new Date();
  now.setHours(hours, minutes, 0, 0);
  return now;
}

/**
 * Get minutes until a scheduled time. Negative if past.
 */
function minutesUntil(timeStr: string): number {
  const target = parseTimeToday(timeStr);
  return (target.getTime() - Date.now()) / 60000;
}

// --- Context Sync Check ---

/** How often to sync context (10 minutes) */
const CONTEXT_SYNC_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Check if context needs a fresh sync.
 */
export function isContextSyncDue(state: WellnessState): boolean {
  if (!state.context.lastSyncAt) return true;
  const lastSync = new Date(state.context.lastSyncAt).getTime();
  return Date.now() - lastSync >= CONTEXT_SYNC_INTERVAL_MS;
}

// --- Evaluation Engine ---

/**
 * Evaluate whether a break should be triggered based on scheduled context.
 * This runs on every prompt with zero I/O - all data is from local cache.
 *
 * Priority:
 * 1. Time-sensitive: High-priority event within its lead time -> BREAK_NOW
 * 2. Natural stopping point + normal break due within 10 min -> SUGGEST
 * 3. Standard timer check is handled by the caller (hook-check.ts)
 * 4. Upcoming break within 10 min (non-blocking nudge) -> BREAK_SOON
 * 5. Otherwise -> ALLOW
 */
export function evaluateContext(
  state: WellnessState,
  promptText: string,
): BreakEvaluation {
  const breaks = state.context.scheduledBreaks;
  if (!breaks || breaks.length === 0) {
    return { decision: "ALLOW" };
  }

  const isStoppingPoint = isNaturalStoppingPoint(promptText);

  for (const sb of breaks) {
    const minsUntil = minutesUntil(sb.time);

    // Already past this break time
    if (minsUntil < -30) continue;

    // 1. High-priority event within its lead time window -> BREAK_NOW
    if (sb.priority === "high" && sb.leadTimeMinutes > 0) {
      if (minsUntil <= sb.leadTimeMinutes && minsUntil > -5) {
        const minsRounded = Math.max(0, Math.round(minsUntil));
        return {
          decision: "BREAK_NOW",
          scheduledBreak: sb,
          message: sb.reason
            ? `${sb.name} in ${minsRounded} min — ${sb.reason}`
            : `${sb.name} starts in ${minsRounded} min`,
        };
      }
    }

    // 2. Natural stopping point + normal break within 10 min -> SUGGEST
    if (isStoppingPoint && minsUntil <= 10 && minsUntil > 0) {
      return {
        decision: "SUGGEST",
        scheduledBreak: sb,
        message: `${sb.name} available when you're ready`,
      };
    }

    // 3. Upcoming break within 10 min (non-blocking nudge) -> BREAK_SOON
    if (minsUntil <= 10 && minsUntil > 0) {
      return {
        decision: "BREAK_SOON",
        scheduledBreak: sb,
        message: sb.reason
          ? `${sb.name} in ${Math.round(minsUntil)} min — ${sb.reason}`
          : `${sb.name} available when you're ready`,
      };
    }
  }

  return { decision: "ALLOW" };
}
