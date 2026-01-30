/**
 * Wellness sync layer
 * Heartbeat sync with Supabase for cross-device completion detection
 */

import { apiRequest } from "../api/client.ts";
import type { WellnessState } from "./state.ts";
import { loadWellnessState, saveWellnessState } from "./state.ts";

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SYNC_TIMEOUT_MS = 2000; // 2-second timeout, fail silently

interface WellnessStatusResponse {
  todayBreakCount: number;
  activeBreak: boolean;
  lastCompletedAt: string | null;
}

/**
 * Check if sync is due (>5 min since last sync)
 */
export function isSyncDue(state: WellnessState): boolean {
  if (!state.sync.lastSyncAt) return true;
  const lastSync = new Date(state.sync.lastSyncAt).getTime();
  return Date.now() - lastSync >= SYNC_INTERVAL_MS;
}

/**
 * Perform heartbeat sync if due.
 * Checks for remote completions and flushes pending offline completions.
 * Fails silently — local state always works.
 */
export async function syncIfDue(): Promise<void> {
  const state = await loadWellnessState();
  if (!isSyncDue(state)) return;

  try {
    await performSync(state);
  } catch {
    // Sync failure is non-critical — local state always works
  }
}

async function performSync(state: WellnessState): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);

  try {
    // Flush pending offline completions
    if (state.sync.pendingCompletions.length > 0) {
      await flushPendingCompletions(state);
    }

    // Check for remote completions (from Flutter app)
    const remoteStatus = await checkRemoteStatus();
    if (remoteStatus) {
      await handleRemoteStatus(state, remoteStatus);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function flushPendingCompletions(state: WellnessState): Promise<void> {
  for (const completion of state.sync.pendingCompletions) {
    try {
      await apiRequest<{ success: boolean }>("lifeprint-api/wellness/complete", {
        method: "POST",
        body: {
          break_type: completion.type,
          completed_at: completion.completedAt,
          source: "cli",
          suggestion_id: completion.suggestionId ?? null,
        },
      });
    } catch {
      // Will retry on next sync
      return;
    }
  }

  // Clear flushed completions
  const newState: WellnessState = {
    ...state,
    sync: {
      ...state.sync,
      pendingCompletions: [],
      lastSyncAt: new Date().toISOString(),
    },
  };
  await saveWellnessState(newState);
}

async function checkRemoteStatus(): Promise<WellnessStatusResponse | null> {
  try {
    const result = await apiRequest<WellnessStatusResponse>(
      "lifeprint-api/wellness/status",
      { method: "GET" },
    );
    return result;
  } catch {
    return null;
  }
}

async function handleRemoteStatus(
  state: WellnessState,
  remote: WellnessStatusResponse,
): Promise<void> {
  // If a break is active locally and was completed remotely (e.g., via Flutter app)
  if (
    state.currentBreak.type !== null &&
    state.currentBreak.completedAt === null &&
    remote.lastCompletedAt
  ) {
    const remoteDone = new Date(remote.lastCompletedAt).getTime();
    const breakTriggered = state.currentBreak.triggeredAt
      ? new Date(state.currentBreak.triggeredAt).getTime()
      : 0;

    // Remote completion happened after break was triggered
    if (remoteDone > breakTriggered) {
      const newState: WellnessState = {
        ...state,
        currentBreak: {
          ...state.currentBreak,
          completedAt: remote.lastCompletedAt,
        },
        sync: {
          ...state.sync,
          lastSyncAt: new Date().toISOString(),
        },
      };
      await saveWellnessState(newState);
      return;
    }
  }

  // Update sync timestamp
  const newState: WellnessState = {
    ...state,
    sync: {
      ...state.sync,
      lastSyncAt: new Date().toISOString(),
    },
  };
  await saveWellnessState(newState);
}
