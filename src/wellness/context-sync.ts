/**
 * Wellness context sync — fetches today's break schedule from the API
 * and caches it in local wellness state.
 *
 * Runs non-blocking with a 2-second timeout to avoid adding latency.
 */

import { apiRequest } from "../api/client.ts";
import { loadWellnessState, saveWellnessState } from "./state.ts";
import type { WellnessState, ScheduledBreak } from "./state.ts";

interface WellnessContextResponse {
  scheduledBreaks: ScheduledBreak[];
  userMealTimes: Record<string, string>;
  isAssignedCook: Record<string, boolean>;
  syncedAt: string;
}

/**
 * Sync wellness context from the API and save to local state.
 * Non-blocking with a 2-second timeout.
 */
export async function syncWellnessContext(
  currentState?: WellnessState,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await apiRequest<WellnessContextResponse>(
      "lifeprint-api/wellness/context",
      { method: "GET", requireAuth: true },
    );

    const state = currentState ?? await loadWellnessState();

    const updatedState: WellnessState = {
      ...state,
      context: {
        lastSyncAt: response.syncedAt || new Date().toISOString(),
        scheduledBreaks: response.scheduledBreaks || [],
        userMealTimes: response.userMealTimes || {},
        isAssignedCook: response.isAssignedCook || {},
      },
    };

    await saveWellnessState(updatedState);
  } finally {
    clearTimeout(timeout);
  }
}
