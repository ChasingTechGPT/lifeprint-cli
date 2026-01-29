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
}

export interface WellnessPowerBreak {
  lastBreakAt: string | null;
  completedToday: number;
  recentActivityIds: string[];
}

export interface WellnessSync {
  lastSyncAt: string | null;
  pendingCompletions: Array<{ type: string; completedAt: string }>;
}

export interface WellnessState {
  version: 1;
  config: WellnessConfig;
  session: WellnessSession;
  currentBreak: WellnessCurrentBreak;
  powerBreak: WellnessPowerBreak;
  sync: WellnessSync;
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

// --- Query Functions ---

export function isConfigured(state: WellnessState): boolean {
  return state.config.sessionLimit.enabled || state.config.powerBreaks.enabled;
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

export function triggerBreak(
  state: WellnessState,
  type: "session_limit" | "power_break",
): WellnessState {
  const now = new Date().toISOString();
  let cooldownMinutes: number;
  let activity: PowerBreakActivity | null = null;

  if (type === "session_limit") {
    cooldownMinutes = state.config.sessionLimit.cooldownMinutes;
  } else {
    cooldownMinutes = 5; // Power breaks auto-expire in 5 min
    activity = selectRandomActivity(state.powerBreak.recentActivityIds);
  }

  const cooldownExpiresAt = new Date(
    Date.now() + cooldownMinutes * 60 * 1000,
  ).toISOString();

  return {
    ...state,
    currentBreak: {
      type,
      triggeredAt: now,
      activityName: activity?.name ?? null,
      activityInstructions: activity?.instructions ?? null,
      cooldownExpiresAt,
      completedAt: null,
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
        { type: breakType ?? "unknown", completedAt: now },
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
    },
    powerBreak: {
      ...state.powerBreak,
      lastBreakAt: null,
      completedToday,
    },
  };
}

export function recordPrompt(state: WellnessState): WellnessState {
  const now = new Date().toISOString();
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
