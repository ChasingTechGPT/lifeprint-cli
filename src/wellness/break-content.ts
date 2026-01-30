/**
 * Fetch break content from LifePrint API
 * Uses sage suggestions or user library content with push notification
 * Falls back to null on any failure (caller uses local activities)
 */

import { apiRequest } from "../api/client.ts";

const BREAK_API_TIMEOUT_MS = 2000;

export interface BreakContentResult {
  suggestionId: string | null;
  contentType: string;
  contentName: string;
  contentId: string | null;
  instructions: string[];
  durationSeconds: number;
  deepLinkUrl: string;
  source: "sage_suggestion" | "library";
  notificationSent: boolean;
}

/**
 * Fetch break content from the API with a 2-second timeout.
 * Returns null on any failure — caller falls back to local activities.
 */
export async function fetchBreakContent(
  breakType: "power_break" | "session_limit",
  recentActivityIds: string[],
): Promise<BreakContentResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BREAK_API_TIMEOUT_MS);

  try {
    const result = await apiRequest<BreakContentResult>(
      "lifeprint-api/wellness/break",
      {
        method: "POST",
        body: {
          break_type: breakType,
          recent_activity_ids: recentActivityIds,
        },
      },
    );
    return result;
  } catch {
    // API down, timeout, auth error — all handled by fallback
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
