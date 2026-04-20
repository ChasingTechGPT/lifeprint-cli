/**
 * `lifeprint work` — log work sessions from Claude Code (or any TTY) into
 * the LifePrint `work_sessions` pipeline owned by PRD-saework.
 *
 * PRD-B01 US-013. Posts to the existing endpoint
 *   POST /functions/v1/lifeprint-api/user/habits/:habit_id/log-work-session
 * which PRD-saework implements; schema (work_sessions table) and validation
 * live there. We mirror WorkSessionPoster.swift's offline-queue pattern.
 *
 * Subcommands
 *   lifeprint work start [--habit-id <uuid>] [--source <str>] [--cwd <path>]
 *                        [--session-id <str>]
 *       Records a start timestamp in ~/.lifeprint/session.json. No network.
 *   lifeprint work stop [--note <str>]
 *       Reads session.json, POSTs the completed session, drains the offline
 *       queue. Clears session.json on success.
 *   lifeprint work status [--json]
 *       Reports whether a session is active; prints JSON if --json.
 *
 * Habit resolution (start)
 *   1. `--habit-id <uuid>` flag wins.
 *   2. Cached choice in `~/.lifeprint/work-habit-map.json` keyed by cwd
 *      basename (e.g., { "LifePrint": "habit-uuid-1", "my-other-repo":
 *      "habit-uuid-2" }) — asked once per project.
 *   3. Auto-match via `GET /functions/v1/lifeprint-api/user/habits?work_match=true`
 *      against `app_bundle_id == "com.anthropic.claude-code"` or cwd basename.
 *   4. If still unresolved, write session.json with `habit_id: null` and
 *      print a warning. Stop will error with a helpful message pointing
 *      the user at `--habit-id`.
 *
 * Offline queue
 *   Failed POSTs append to `~/.lifeprint/work-session-queue.json`. Every
 *   `stop` and `start` attempts to drain. Max 10 attempts per entry before
 *   drop.
 */

import { Command } from "@cliffy/command";
import { apiRequest, ApiError, AuthRequiredError } from "../../api/client.ts";

// ============================================================================
// PATHS + SHAPES
// ============================================================================

function lifeprintDir(): string {
  const home = Deno.env.get("HOME") ?? "/tmp";
  return `${home}/.lifeprint`;
}

const SESSION_FILE = `${lifeprintDir()}/session.json`;
const QUEUE_FILE = `${lifeprintDir()}/work-session-queue.json`;
const HABIT_MAP_FILE = `${lifeprintDir()}/work-habit-map.json`;

interface ActiveSession {
  habit_id: string | null;
  source: string;
  cwd: string | null;
  cwd_basename: string | null;
  session_id: string | null;
  app_bundle_id: string;
  started_at: string;
  sample_count: number;
}

interface QueuedSession {
  habit_id: string;
  started_at: string;
  ended_at: string;
  app_bundle_id: string;
  primary_window_title: string | null;
  sample_count: number;
  attempts: number;
  enqueued_at: string;
}

// ============================================================================
// FS HELPERS
// ============================================================================

async function ensureDir(): Promise<void> {
  try {
    await Deno.mkdir(lifeprintDir(), { recursive: true });
  } catch {
    // already exists
  }
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    const text = await Deno.readTextFile(path);
    return JSON.parse(text) as T;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

async function writeJsonAtomic<T>(path: string, value: T): Promise<void> {
  await ensureDir();
  const tmp = `${path}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify(value, null, 2));
  await Deno.rename(tmp, path);
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
}

// ============================================================================
// HABIT RESOLUTION
// ============================================================================

function basenameOfCwd(cwd: string | null): string | null {
  if (!cwd) return null;
  const parts = cwd.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

async function resolveHabitId(opts: {
  explicitHabitId?: string;
  cwd: string | null;
}): Promise<string | null> {
  if (opts.explicitHabitId) return opts.explicitHabitId;
  const base = basenameOfCwd(opts.cwd);
  if (!base) return null;

  // Cached map lookup
  const map = await readJsonIfExists<Record<string, string>>(HABIT_MAP_FILE);
  if (map && map[base]) return map[base];

  // Remote auto-match
  try {
    interface HabitRow {
      id: string;
      work_match_rule?: {
        bundle_id?: string;
        bundle_id_in?: string[];
        window_title_contains?: string;
        window_title_regex?: string;
      };
    }
    const res = await apiRequest<{ habits?: HabitRow[] }>(
      "/lifeprint-api/user/habits?work_match=true",
      { method: "GET", requireAuth: true },
    );
    const habits: HabitRow[] = res.habits ?? [];
    const match = habits.find((h: HabitRow) => {
      const rule = h.work_match_rule;
      if (!rule) return false;
      const claude = "com.anthropic.claude-code";
      if (rule.bundle_id === claude) return true;
      if (rule.bundle_id_in?.includes(claude)) return true;
      if (rule.window_title_contains && base.includes(rule.window_title_contains)) return true;
      return false;
    });
    if (match) {
      // Remember for next time
      const updated = { ...(map ?? {}), [base]: match.id };
      await writeJsonAtomic(HABIT_MAP_FILE, updated);
      return match.id;
    }
  } catch (err) {
    if (err instanceof AuthRequiredError) throw err;
    // Fall through to null — user can supply --habit-id to unblock.
    console.warn(`[lifeprint work] habit auto-match failed: ${(err as Error).message}`);
  }
  return null;
}

// ============================================================================
// QUEUE DRAIN (mirrors WorkSessionPoster.swift)
// ============================================================================

const MAX_ATTEMPTS = 10;

async function loadQueue(): Promise<QueuedSession[]> {
  return (await readJsonIfExists<QueuedSession[]>(QUEUE_FILE)) ?? [];
}

async function saveQueue(queue: QueuedSession[]): Promise<void> {
  if (queue.length === 0) {
    await removeIfExists(QUEUE_FILE);
    return;
  }
  await writeJsonAtomic(QUEUE_FILE, queue);
}

async function enqueue(entry: QueuedSession): Promise<void> {
  const queue = await loadQueue();
  queue.push(entry);
  await saveQueue(queue);
}

async function postOne(entry: QueuedSession): Promise<boolean> {
  try {
    await apiRequest(
      `/lifeprint-api/user/habits/${encodeURIComponent(entry.habit_id)}/log-work-session`,
      {
        method: "POST",
        requireAuth: true,
        body: {
          started_at: entry.started_at,
          ended_at: entry.ended_at,
          app_bundle_id: entry.app_bundle_id,
          primary_window_title: entry.primary_window_title,
          sample_count: entry.sample_count,
        },
      },
    );
    return true;
  } catch (err) {
    // AuthRequiredError = "not logged in". Keep queued; next `lifeprint login`
    // run + a `work start|stop` call will drain. Don't crash the caller.
    if (err instanceof AuthRequiredError) return false;
    const status = err instanceof ApiError ? err.status : 0;
    // 4xx (except 401/429) are permanent — drop to avoid infinite retries.
    if (status >= 400 && status < 500 && status !== 401 && status !== 429) {
      console.warn(`[lifeprint work] permanent error ${status} — dropping queued session`);
      return true; // treat as "processed" so it's removed from queue
    }
    return false;
  }
}

async function drainQueue(): Promise<{ sent: number; remaining: number; dropped: number }> {
  const queue = await loadQueue();
  const keep: QueuedSession[] = [];
  let sent = 0;
  let dropped = 0;
  for (const entry of queue) {
    const ok = await postOne(entry);
    if (ok) {
      sent++;
      continue;
    }
    // Retry with exponential cap
    const next = { ...entry, attempts: entry.attempts + 1 };
    if (next.attempts >= MAX_ATTEMPTS) {
      dropped++;
      continue;
    }
    keep.push(next);
    // Stop draining on first failure — don't hammer the API
    const restIdx = queue.indexOf(entry) + 1;
    for (let i = restIdx; i < queue.length; i++) keep.push(queue[i]);
    break;
  }
  await saveQueue(keep);
  return { sent, remaining: keep.length, dropped };
}

// ============================================================================
// COMMAND: start
// ============================================================================

const startSubCommand = new Command()
  .description("Start a work session. Writes ~/.lifeprint/session.json.")
  .option("--habit-id <id:string>", "Explicit habit UUID to attribute this session to.")
  .option("--source <s:string>", "Session source label (e.g. claude_code, tty).", {
    default: "claude_code",
  })
  .option("--cwd <path:string>", "Working directory of the session. Defaults to $PWD.")
  .option("--session-id <id:string>", "Opaque correlation id (e.g. $CLAUDE_SESSION_ID).")
  .action(async (opts) => {
    const existing = await readJsonIfExists<ActiveSession>(SESSION_FILE);
    if (existing) {
      console.error(
        `Session already active (started ${existing.started_at}). Run 'lifeprint work stop' first.`,
      );
      Deno.exit(3);
    }
    const cwd = opts.cwd ?? Deno.cwd();
    let habitId: string | null = null;
    try {
      habitId = await resolveHabitId({ explicitHabitId: opts.habitId, cwd });
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        console.error((err as Error).message);
        Deno.exit(1);
      }
      console.warn(`[lifeprint work] habit resolution failed: ${(err as Error).message}`);
    }

    if (!habitId) {
      console.warn(
        "No habit matched. Session will start but 'stop' will fail unless a habit is configured. " +
          "Set one now with: lifeprint work start --habit-id <uuid>",
      );
    }

    const session: ActiveSession = {
      habit_id: habitId,
      source: opts.source,
      cwd,
      cwd_basename: basenameOfCwd(cwd),
      session_id: opts.sessionId ?? null,
      app_bundle_id: "com.anthropic.claude-code",
      started_at: new Date().toISOString(),
      sample_count: 0,
    };
    await writeJsonAtomic(SESSION_FILE, session);
    // Fire-and-forget drain — don't block user on queue retries
    drainQueue().catch(() => undefined);
    console.log(`started ${session.started_at}${habitId ? ` (habit ${habitId})` : ""}`);
  });

// ============================================================================
// COMMAND: stop
// ============================================================================

const stopSubCommand = new Command()
  .description("Stop the active work session and post to the server.")
  .option("--note <s:string>", "Optional note to include as primary_window_title.")
  .action(async (opts) => {
    const session = await readJsonIfExists<ActiveSession>(SESSION_FILE);
    if (!session) {
      console.error("No active session. Run 'lifeprint work start' first.");
      Deno.exit(3);
    }
    const endedAt = new Date().toISOString();
    if (!session.habit_id) {
      console.error(
        "Session has no habit_id. Run 'lifeprint work stop' again after setting " +
          "one with 'lifeprint work start --habit-id <uuid>' on your next session, " +
          "or delete ~/.lifeprint/session.json to abandon.",
      );
      Deno.exit(4);
    }
    const entry: QueuedSession = {
      habit_id: session.habit_id,
      started_at: session.started_at,
      ended_at: endedAt,
      app_bundle_id: session.app_bundle_id,
      primary_window_title: opts.note ?? session.cwd_basename,
      sample_count: session.sample_count,
      attempts: 0,
      enqueued_at: endedAt,
    };
    // Enqueue first so a crash between post-attempt and cleanup doesn't lose the session.
    await enqueue(entry);
    await removeIfExists(SESSION_FILE);
    const result = await drainQueue();
    console.log(
      `stopped ${endedAt} — posted=${result.sent}, queued=${result.remaining}, dropped=${result.dropped}`,
    );
  });

// ============================================================================
// COMMAND: status
// ============================================================================

const statusSubCommand = new Command()
  .description("Report the current work session (if any) and queue depth.")
  .option("--json", "Emit JSON instead of a human-readable line.")
  .action(async (opts) => {
    const session = await readJsonIfExists<ActiveSession>(SESSION_FILE);
    const queue = await loadQueue();
    const now = Date.now();
    const elapsedSeconds = session
      ? Math.max(0, Math.floor((now - new Date(session.started_at).getTime()) / 1000))
      : 0;
    if (opts.json) {
      console.log(
        JSON.stringify({
          active: !!session,
          habit_id: session?.habit_id ?? null,
          started_at: session?.started_at ?? null,
          elapsed_seconds: elapsedSeconds,
          queue_size: queue.length,
        }),
      );
      return;
    }
    if (!session) {
      console.log(`idle · queue=${queue.length}`);
      return;
    }
    const mins = Math.floor(elapsedSeconds / 60);
    console.log(
      `active · habit=${session.habit_id ?? "<none>"} · ${mins}m elapsed · queue=${queue.length}`,
    );
  });

// ============================================================================
// PARENT COMMAND
// ============================================================================

export const workCommand = new Command()
  .description("Manage LifePrint work sessions (Claude Code hooks integration).")
  .action(function () {
    // When invoked without a subcommand, show help.
    this.showHelp();
  })
  .command("start", startSubCommand)
  .command("stop", stopSubCommand)
  .command("status", statusSubCommand);
