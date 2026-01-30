/**
 * Wellness state management for LifePrint CLI
 * Stores session timers, break state, and config in ~/.lifeprint/wellness.json
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { getConfigDir } from "../auth/credentials.ts";
import { selectRandomActivity } from "./activities.ts";
import type { PowerBreakActivity } from "./activities.ts";

// --- Types ---

export interface WellnessConfig {
  sessionLimit: {
    enabled: boolean;
    durationMinutes: number; // 120, 180, 240
    cooldownMinutes: number; // 15, 30, 60
  };
  powerBreaks: {
    enabled: boolean;
    intervalMinutes: number; // 30, 45, 60
  };
}

export interface WellnessSession {
  startedAt: string | null; // ISO timestamp
  promptCount: number;
  lastPromptAt: string | null;
}

export interface WellnessCurrentBreak {
  type: "session_limit" | "power_break" | null;
  triggeredAt: string | null;
  activityName: string | null;
  activityInstructions: string[] | null;
  cooldownExpiresAt: string | null;
  completedAt: string | null;
  suggestionId: string | null;
  contentType: string | null;
  contentId: string | null;
  deepLinkUrl: string | null;
}

export interface WellnessPowerBreak {
  lastBreakAt: string | null;
  completedToday: number;
  recentActivityIds: string[];
}

export interface WellnessSync {
  lastSyncAt: string | null;
  pendingCompletions: Array<{
    type: string;
    completedAt: string;
    suggestionId?: string | null;
  }>;
}

export interface ScheduledBreak {
  time: string;
  suggestionId: string;
  contentType: string;
  name: string;
  priority: "high" | "normal";
  leadTimeMinutes: number;
  reason?: string;
}

export interface WellnessContext {
  lastSyncAt: string | null;
  scheduledBreaks: ScheduledBreak[];
  userMealTimes: Record<string, string>;
  isAssignedCook: Record<string, boolean>;
}

export interface WellnessState {
  version: 1;
  config: WellnessConfig;
  session: WellnessSession;
  currentBreak: WellnessCurrentBreak;
  powerBreak: WellnessPowerBreak;
  sync: WellnessSync;
  context: WellnessContext;
}

// --- Defaults ---

export function createDefaultState(): WellnessState {
  return {
    version: 1,
    config: {
      sessionLimit: {
        enabled: false,
        durationMinutes: 120,
        cooldownMinutes: 30,
      },
      powerBreaks: {
        enabled: false,
        intervalMinutes: 45,
      },
    },
    session: {
      startedAt: null,
      promptCount: 0,
      lastPromptAt: null,
    },
    currentBreak: {
      type: null,
      triggeredAt: null,
      activityName: null,
      activityInstructions: null,
      cooldownExpiresAt: null,
      completedAt: null,
      suggestionId: null,
      contentType: null,
      contentId: null,
      deepLinkUrl: null,
    },
    powerBreak: {
      lastBreakAt: null,
      completedToday: 0,
      recentActivityIds: [],
    },
    sync: {
      lastSyncAt: null,
      pendingCompletions: [],
    },
    context: {
      lastSyncAt: null,
      scheduledBreaks: [],
      userMealTimes: {},
      isAssignedCook: {},
    },
  };
}

// --- File I/O ---

export function getWellnessPath(): string {
  return join(getConfigDir(), "wellness.json");
}

export async function loadWellnessState(): Promise<WellnessState> {
  try {
    const path = getWellnessPath();
    const content = await Deno.readTextFile(path);
    const data = JSON.parse(content) as WellnessState;
    if (data.version !== 1) {
      return createDefaultState();
    }
    return data;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return createDefaultState();
    }
    throw error;
  }
}

export async function saveWellnessState(state: WellnessState): Promise<void> {
  await ensureDir(getConfigDir());
  const path = getWellnessPath();
  await Deno.writeTextFile(path, JSON.stringify(state, null, 2));
  if (Deno.build.os !== "windows") {
    await Deno.chmod(path, 0o600);
  }
}

// --- Constants ---

/**
 * If the user hasn't sent a prompt in this many minutes, consider the session idle.
 * When idle, we auto-reset the session to prevent false positives from leaving
 * terminals open overnight.
 */
export const IDLE_THRESHOLD_MINUTES = 30;

// --- Query Functions ---

export function isConfigured(state: WellnessState): boolean {
  return state.config.sessionLimit.enabled || state.config.powerBreaks.enabled;
}

/**
 * Check if the session has been idle for too long (no prompts in IDLE_THRESHOLD_MINUTES).
 * Returns true if the session should be auto-reset.
 */
export function isSessionIdle(state: WellnessState): boolean {
  if (!state.session.lastPromptAt) {
    // No prompts yet in this session - check session start time
    if (!state.session.startedAt) return false;
    const startTime = new Date(state.session.startedAt).getTime();
    const idleThreshold = IDLE_THRESHOLD_MINUTES * 60 * 1000;
    return Date.now() - startTime >= idleThreshold;
  }

  const lastPromptTime = new Date(state.session.lastPromptAt).getTime();
  const idleThreshold = IDLE_THRESHOLD_MINUTES * 60 * 1000;
  return Date.now() - lastPromptTime >= idleThreshold;
}

export function getTimeWorkedMs(state: WellnessState): number {
  if (!state.session.startedAt) return 0;
  const start = new Date(state.session.startedAt).getTime();
  return Date.now() - start;
}

export function getTimeWorkedFormatted(state: WellnessState): string {
  const ms = getTimeWorkedMs(state);
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function isSessionLimitReached(state: WellnessState): boolean {
  if (!state.config.sessionLimit.enabled) return false;
  if (!state.session.startedAt) return false;
  const worked = getTimeWorkedMs(state);
  const limit = state.config.sessionLimit.durationMinutes * 60 * 1000;
  return worked >= limit;
}

export function isPowerBreakDue(state: WellnessState): boolean {
  if (!state.config.powerBreaks.enabled) return false;
  if (!state.session.startedAt) return false;

  const interval = state.config.powerBreaks.intervalMinutes * 60 * 1000;
  const lastBreak = state.powerBreak.lastBreakAt
    ? new Date(state.powerBreak.lastBreakAt).getTime()
    : new Date(state.session.startedAt).getTime();

  return Date.now() - lastBreak >= interval;
}

export function isBreakActive(state: WellnessState): boolean {
  return state.currentBreak.type !== null && state.currentBreak.completedAt === null;
}

/**
 * Check if there's a break that needs processing (active, completed, or expired).
 * This is used to ensure the hook enters the break-handling logic even after completion.
 */
export function hasBreakToProcess(state: WellnessState): boolean {
  return state.currentBreak.type !== null;
}

export function isBreakCompleteOrExpired(state: WellnessState): boolean {
  if (!state.currentBreak.type) return false;

  // Completed via CLI or app
  if (state.currentBreak.completedAt) return true;

  // Cooldown expired
  if (state.currentBreak.cooldownExpiresAt) {
    const expires = new Date(state.currentBreak.cooldownExpiresAt).getTime();
    return Date.now() >= expires;
  }

  return false;
}

export function getTimeUntilNextBreak(state: WellnessState): number | null {
  if (!state.config.powerBreaks.enabled) return null;
  if (!state.session.startedAt) return null;

  const interval = state.config.powerBreaks.intervalMinutes * 60 * 1000;
  const lastBreak = state.powerBreak.lastBreakAt
    ? new Date(state.powerBreak.lastBreakAt).getTime()
    : new Date(state.session.startedAt).getTime();

  const nextBreakAt = lastBreak + interval;
  const remaining = nextBreakAt - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function getTimeUntilSessionLimit(state: WellnessState): number | null {
  if (!state.config.sessionLimit.enabled) return null;
  if (!state.session.startedAt) return null;

  const limit = state.config.sessionLimit.durationMinutes * 60 * 1000;
  const start = new Date(state.session.startedAt).getTime();
  const limitAt = start + limit;
  const remaining = limitAt - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function getCooldownRemaining(state: WellnessState): number {
  if (!state.currentBreak.cooldownExpiresAt) return 0;
  const expires = new Date(state.currentBreak.cooldownExpiresAt).getTime();
  const remaining = expires - Date.now();
  return remaining > 0 ? remaining : 0;
}

// --- Mutation Functions ---

export interface ApiBreakContent {
  suggestionId: string | null;
  contentType: string;
  contentName: string;
  contentId: string | null;
  instructions: string[];
  durationSeconds: number;
  deepLinkUrl: string;
}

export function triggerBreak(
  state: WellnessState,
  type: "session_limit" | "power_break",
  apiContent?: ApiBreakContent | null,
): WellnessState {
  const now = new Date().toISOString();
  let cooldownMinutes: number;
  let activity: PowerBreakActivity | null = null;

  if (type === "session_limit") {
    cooldownMinutes = state.config.sessionLimit.cooldownMinutes;
  } else {
    cooldownMinutes = 5; // Power breaks auto-expire in 5 min
    if (!apiContent) {
      activity = selectRandomActivity(state.powerBreak.recentActivityIds);
    }
  }

  const cooldownExpiresAt = new Date(
    Date.now() + cooldownMinutes * 60 * 1000,
  ).toISOString();

  return {
    ...state,
    currentBreak: {
      type,
      triggeredAt: now,
      activityName: apiContent?.contentName ?? activity?.name ?? null,
      activityInstructions: apiContent?.instructions ?? activity?.instructions ?? null,
      cooldownExpiresAt,
      completedAt: null,
      suggestionId: apiContent?.suggestionId ?? null,
      contentType: apiContent?.contentType ?? null,
      contentId: apiContent?.contentId ?? null,
      deepLinkUrl: apiContent?.deepLinkUrl ?? null,
    },
  };
}

export function completeBreak(state: WellnessState): WellnessState {
  const now = new Date().toISOString();
  const breakType = state.currentBreak.type;

  const newState: WellnessState = {
    ...state,
    currentBreak: {
      ...state.currentBreak,
      completedAt: now,
    },
    sync: {
      ...state.sync,
      pendingCompletions: [
        ...state.sync.pendingCompletions,
        {
          type: breakType ?? "unknown",
          completedAt: now,
          suggestionId: state.currentBreak.suggestionId,
        },
      ],
    },
  };

  if (breakType === "power_break") {
    const recentIds = [...state.powerBreak.recentActivityIds];
    // Keep a sliding window of recent activity IDs to avoid repeats
    if (state.currentBreak.activityName) {
      recentIds.push(state.currentBreak.activityName);
      if (recentIds.length > 5) recentIds.shift();
    }
    newState.powerBreak = {
      lastBreakAt: now,
      completedToday: state.powerBreak.completedToday + 1,
      recentActivityIds: recentIds,
    };
  }

  return newState;
}

export function resetBreakState(state: WellnessState): WellnessState {
  return {
    ...state,
    currentBreak: {
      type: null,
      triggeredAt: null,
      activityName: null,
      activityInstructions: null,
      cooldownExpiresAt: null,
      completedAt: null,
      suggestionId: null,
      contentType: null,
      contentId: null,
      deepLinkUrl: null,
    },
  };
}

export function resetSession(state: WellnessState): WellnessState {
  const now = new Date().toISOString();

  // Reset the daily power break counter if it's a new day
  const today = new Date().toDateString();
  const lastBreakDay = state.powerBreak.lastBreakAt
    ? new Date(state.powerBreak.lastBreakAt).toDateString()
    : null;
  const completedToday = lastBreakDay === today ? state.powerBreak.completedToday : 0;

  return {
    ...state,
    session: {
      startedAt: now,
      promptCount: 0,
      lastPromptAt: null,
    },
    currentBreak: {
      type: null,
      triggeredAt: null,
      activityName: null,
      activityInstructions: null,
      cooldownExpiresAt: null,
      completedAt: null,
      suggestionId: null,
      contentType: null,
      contentId: null,
      deepLinkUrl: null,
    },
    powerBreak: {
      ...state.powerBreak,
      lastBreakAt: null,
      completedToday,
    },
  };
}

/**
 * Record a new prompt, resetting the session if it was idle.
 * This prevents false positives from leaving terminals open overnight.
 */
export function recordPrompt(state: WellnessState): WellnessState {
  const now = new Date().toISOString();

  // If session was idle, start fresh
  if (isSessionIdle(state)) {
    return {
      ...state,
      session: {
        startedAt: now,
        promptCount: 1,
        lastPromptAt: now,
      },
      // Also reset power break timer since this is a fresh session
      powerBreak: {
        ...state.powerBreak,
        lastBreakAt: null,
      },
    };
  }

  return {
    ...state,
    session: {
      startedAt: state.session.startedAt ?? now,
      promptCount: state.session.promptCount + 1,
      lastPromptAt: now,
    },
  };
}

export function formatMs(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes} minutes`;
}

export function formatTimeOfDay(isoString: string): string {
  const d = new Date(isoString);
  const hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 || 12;
  return `${h}:${minutes} ${ampm}`;
}
