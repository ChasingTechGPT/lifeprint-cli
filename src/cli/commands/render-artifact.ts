/**
 * `lifeprint render-artifact` — renders a Sage plan artifact to a
 * self-contained HTML file for Claude Code's desktop preview pane.
 *
 * Design note (PRD-B01 US-011):
 *
 *   The PRD originally called for React SSR via renderToStaticMarkup
 *   to share a single component source-of-truth with the Web_App and
 *   Mac WKWebView. However, the lifeprint-cli is a Deno binary
 *   (deno compile) that cannot realistically embed React-DOM server
 *   at runtime. Rather than ship a Node sub-process for rendering,
 *   we write equivalent HTML templates here using the same design
 *   tokens. The visual-parity Playwright test (US-012) catches drift
 *   between this Deno renderer and the React components.
 *
 *   When/if the CLI gains a Node sidecar for richer rendering, this
 *   file can be thinned to "call Node, capture HTML, write file".
 *
 * Input: JSON on stdin matching the `sage.render_plan_artifact` tool
 * result shape:
 *
 *   {
 *     artifact_id: string,
 *     kind: "agenda_diff" | "habit_progress" | "goal_roadmap" | "weekly_review",
 *     data: AgendaDiffData | HabitProgressData | GoalRoadmapData | WeeklyReviewData,
 *     generated_at: string,
 *     expires_hint: string | null
 *   }
 *
 * Output: path to `/tmp/lifeprint-artifact-<id>.html` on stdout.
 */

import { Command } from "@cliffy/command";

// ============================================================================
// DESIGN TOKENS (mirrors lifeprint-components-react/src/theme/tokens.ts)
// ============================================================================

const TOKENS = {
  colorPrimary: "#6366F1",
  colorPrimaryLight: "#818CF8",
  colorPrimaryDark: "#4F46E5",
  colorAccent: "#F59E0B",
  colorBackground: "#F9FAFB",
  colorBackgroundAlt: "#F3F4F6",
  colorSurface: "#FFFFFF",
  colorText: "#111827",
  colorTextMuted: "#6B7280",
  colorTextLight: "#9CA3AF",
  colorBorder: "#E5E7EB",
  colorBorderLight: "#F3F4F6",
  colorSuccess: "#10B981",
  colorWarning: "#F59E0B",
  colorError: "#EF4444",
  colorInfo: "#3B82F6",
  domainNutrition: "#4CAF50",
  domainMovement: "#10B981",
  domainWellness: "#8B5CF6",
  domainSocial: "#F59E0B",
  domainReading: "#3B82F6",
  fontSans:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontMono: '"SF Mono", "Fira Code", "Fira Mono", Menlo, Monaco, Consolas, monospace',
  radiusMd: "0.5rem",
  radiusLg: "0.75rem",
  radiusXl: "1rem",
  radiusFull: "9999px",
  shadowMd: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
};

type ArtifactKind =
  | "agenda_diff"
  | "habit_progress"
  | "goal_roadmap"
  | "weekly_review";

type Domain =
  | "nutrition"
  | "movement"
  | "wellness"
  | "social"
  | "reading";

interface ArtifactResult {
  artifact_id?: string;
  kind: ArtifactKind;
  data: unknown;
  generated_at?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function escape(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Sanitize an artifact_id for use as a filename component.
 *
 * Security rationale: the artifact_id flows from MCP tool response JSON
 * into the path `/tmp/lifeprint-artifact-<id>.html`. A malicious payload
 * containing path-traversal sequences (e.g. `../../../etc/passwd`) would
 * otherwise let the attacker write HTML to arbitrary filesystem locations
 * via this CLI. We reject everything except alphanumeric + underscore +
 * dash, and cap length at 64 chars to avoid filesystem-limit edge cases.
 */
function sanitizeArtifactId(id: string | undefined): string {
  if (!id) return `art_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cleaned = String(id).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return cleaned || `art_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function domainColor(d: unknown): string {
  const k = String(d ?? "wellness");
  switch (k) {
    case "nutrition":
      return TOKENS.domainNutrition;
    case "movement":
      return TOKENS.domainMovement;
    case "wellness":
      return TOKENS.domainWellness;
    case "social":
      return TOKENS.domainSocial;
    case "reading":
      return TOKENS.domainReading;
    default:
      return TOKENS.domainWellness;
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDate(s: string): string {
  try {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const d = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(s);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return s;
  }
}

function renderInlineMarkdown(text: string): string {
  let out = escape(text);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return out;
}

// Style builder helper.
function s(css: Record<string, string | number>): string {
  return Object.entries(css)
    .map(([k, v]) => {
      const kebab = k.replace(/([A-Z])/g, "-$1").toLowerCase();
      return `${kebab}:${v}`;
    })
    .join(";");
}

// ============================================================================
// KIND-SPECIFIC RENDERERS
// ============================================================================

interface AgendaItem {
  id: string;
  title: string;
  time?: string;
  domain: Domain;
  duration_minutes?: number;
}

function renderAgendaDiff(data: any): string {
  const before: AgendaItem[] = Array.isArray(data?.before) ? data.before : [];
  const after: AgendaItem[] = Array.isArray(data?.after) ? data.after : [];
  const reason: string = String(data?.reason ?? "");
  const afterIds = new Map<string, number>(
    after.map((it, i) => [it.id, i]),
  );
  const beforeIds = new Set<string>(before.map((b) => b.id));

  const renderItem = (it: AgendaItem, state: "unchanged" | "moved" | "new" | "removed"): string => {
    const color = domainColor(it.domain);
    const isMoved = state === "moved";
    const isNew = state === "new";
    const isRemoved = state === "removed";
    const bg = isRemoved
      ? "#FEE2E2"
      : isNew
      ? `${color}14`
      : isMoved
      ? `${TOKENS.colorPrimary}0D`
      : TOKENS.colorSurface;
    const border = isRemoved
      ? `1px solid ${TOKENS.colorError}55`
      : isNew
      ? `1px dashed ${color}80`
      : isMoved
      ? `1px solid ${TOKENS.colorPrimary}80`
      : `1px solid ${TOKENS.colorBorder}`;
    const opacity = state === "unchanged" ? "0.55" : "1";
    const textStyle = isRemoved ? "text-decoration:line-through;" : "";
    const tag = isNew
      ? `<span style="${s({ background: `${color}22`, color, fontSize: "0.6rem", fontWeight: 700, padding: "2px 6px", borderRadius: TOKENS.radiusFull, letterSpacing: "0.05em", textTransform: "uppercase" })}">New</span>`
      : isMoved
      ? `<span style="${s({ background: `${TOKENS.colorPrimary}1A`, color: TOKENS.colorPrimary, fontSize: "0.6rem", fontWeight: 700, padding: "2px 6px", borderRadius: TOKENS.radiusFull, letterSpacing: "0.05em", textTransform: "uppercase" })}">Moved</span>`
      : isRemoved
      ? `<span style="${s({ background: `${TOKENS.colorError}1A`, color: TOKENS.colorError, fontSize: "0.6rem", fontWeight: 700, padding: "2px 6px", borderRadius: TOKENS.radiusFull, letterSpacing: "0.05em", textTransform: "uppercase" })}">Removed</span>`
      : "";
    return `
      <div style="${s({ height: "56px", padding: "4px 8px", border, background: bg, opacity, borderRadius: TOKENS.radiusMd, display: "flex", alignItems: "center", gap: "8px", boxSizing: "border-box" })};${textStyle}">
        <span style="${s({ width: "8px", height: "8px", borderRadius: "50%", background: color, flexShrink: "0", boxShadow: `0 0 0 2px ${color}33` })}"></span>
        <span style="${s({ fontSize: "0.72rem", fontWeight: 600, color: TOKENS.colorTextMuted, fontVariantNumeric: "tabular-nums", flexShrink: "0", minWidth: "3.2rem" })}">${escape(it.time ?? "—")}</span>
        <span style="${s({ fontSize: "0.82rem", fontWeight: 500, color: TOKENS.colorText, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: "1" })}">${escape(it.title)}</span>
        ${tag}
      </div>`;
  };

  const beforeRows = before.map((it, i) => {
    const afterIdx = afterIds.get(it.id);
    if (afterIdx === undefined) return renderItem(it, "removed");
    if (afterIdx !== i) return renderItem(it, "moved");
    return renderItem(it, "unchanged");
  }).join("");

  const afterRows = after.map((it, i) => {
    if (!beforeIds.has(it.id)) return renderItem(it, "new");
    const beforeIdx = before.findIndex((b) => b.id === it.id);
    if (beforeIdx !== i) return renderItem(it, "moved");
    return renderItem(it, "unchanged");
  }).join("");

  return `
    ${reason ? `<div style="${s({ fontSize: "0.85rem", color: TOKENS.colorTextMuted, fontStyle: "italic", marginBottom: "16px", lineHeight: "1.5" })}">${escape(reason)}</div>` : ""}
    <div style="${s({ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" })}">
      <div>
        <div style="${s({ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: TOKENS.colorTextMuted, marginBottom: "8px", paddingBottom: "4px", borderBottom: `1px solid ${TOKENS.colorBorderLight}` })}">Before</div>
        <div style="${s({ display: "flex", flexDirection: "column", gap: "8px" })}">${beforeRows}</div>
      </div>
      <div>
        <div style="${s({ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: TOKENS.colorTextMuted, marginBottom: "8px", paddingBottom: "4px", borderBottom: `1px solid ${TOKENS.colorBorderLight}` })}">After</div>
        <div style="${s({ display: "flex", flexDirection: "column", gap: "8px" })}">${afterRows}</div>
      </div>
    </div>`;
}

function renderHabitProgress(data: any): string {
  const habits = Array.isArray(data?.habits) ? data.habits : [];
  const weekStart: string = String(data?.week_start ?? "");
  if (habits.length === 0) {
    return `<div style="${s({ color: TOKENS.colorTextMuted, padding: "24px", textAlign: "center" })}">No habits tracked yet for this week.</div>`;
  }
  const rows = habits.map((h: any) => {
    const color = domainColor(h.domain);
    const current = Number(h.current ?? 0);
    const target = Number(h.weekly_target ?? 0);
    const pct = target > 0 ? Math.min(100, Math.max(0, (current / target) * 100)) : 0;
    const history: number[] = Array.isArray(h.history)
      ? h.history.map((v: unknown) => Number(v ?? 0))
      : [];
    const max = Math.max(1, ...history);
    const points = history.map((v, i) => {
      const x = (i * 112) / Math.max(1, history.length - 1);
      const y = 28 - 3 - (v / (max * 1.1)) * (28 - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return `
      <div style="${s({ display: "flex", alignItems: "center", gap: "16px", padding: "8px", border: `1px solid ${TOKENS.colorBorderLight}`, background: TOKENS.colorSurface, borderRadius: TOKENS.radiusMd, boxSizing: "border-box" })}">
        <span style="${s({ width: "10px", height: "10px", borderRadius: "50%", background: color, boxShadow: `0 0 0 2px ${color}33` })}"></span>
        <span style="${s({ fontSize: "0.85rem", fontWeight: 600, color: TOKENS.colorText, minWidth: "8rem", flex: "0 1 14rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" })}">${escape(h.name)}</span>
        <svg width="112" height="28" viewBox="0 0 112 28" style="flex-shrink:0;display:block">
          <line x1="0" y1="25" x2="112" y2="25" stroke="${TOKENS.colorBorderLight}" stroke-width="1"/>
          <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div style="${s({ flex: "1", minWidth: "6rem", display: "flex", flexDirection: "column", gap: "4px" })}">
          <div style="${s({ height: "8px", background: TOKENS.colorBorderLight, borderRadius: TOKENS.radiusFull, overflow: "hidden" })}"><div style="${s({ height: "100%", width: `${pct}%`, background: color, borderRadius: TOKENS.radiusFull })}"></div></div>
          <span style="${s({ fontSize: "0.72rem", color: TOKENS.colorTextMuted, fontVariantNumeric: "tabular-nums" })}">${current} / ${target} this week · ${Math.round(pct)}%</span>
        </div>
      </div>`;
  }).join("");
  return `
    <div style="${s({ fontSize: "0.8rem", color: TOKENS.colorTextMuted, marginBottom: "16px" })}">Week of ${escape(formatDate(weekStart))}</div>
    <div style="${s({ display: "flex", flexDirection: "column", gap: "4px" })}">${rows}</div>`;
}

function renderGoalRoadmap(data: any): string {
  const goals = Array.isArray(data?.goals) ? data.goals : [];
  if (goals.length === 0) {
    return `<div style="${s({ color: TOKENS.colorTextMuted, padding: "24px", textAlign: "center" })}">No goals set yet.</div>`;
  }
  return goals.map((g: any) => {
    const color = domainColor(g.domain);
    const milestones = Array.isArray(g.milestones) ? g.milestones : [];
    const completed = milestones.filter((m: any) => m.completed).length;
    const total = milestones.length;
    let pct = 0;
    if (total > 0) {
      if (completed === total) pct = 100;
      else if (completed > 0 && total > 1) pct = ((completed - 0.5) / (total - 1)) * 100;
    }
    const nodes = milestones.map((m: any) => {
      const mColor = m.completed ? color : TOKENS.colorSurface;
      const label = m.completed ? TOKENS.colorText : TOKENS.colorTextMuted;
      return `
        <div style="${s({ position: "relative", display: "flex", alignItems: "center", gap: "8px", padding: "4px 0", minHeight: "28px" })}">
          <span style="${s({ position: "absolute", left: "-22px", top: "50%", transform: "translateY(-50%)", width: "14px", height: "14px", borderRadius: "50%", background: mColor, border: `2px solid ${color}`, boxShadow: m.completed ? `0 0 0 3px ${color}22` : "none", boxSizing: "border-box" })}"></span>
          <span style="${s({ fontSize: "0.82rem", fontWeight: m.completed ? 500 : 400, color: label, flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" })}">${escape(m.label)}</span>
          <span style="${s({ fontSize: "0.7rem", color: TOKENS.colorTextMuted, fontVariantNumeric: "tabular-nums", flexShrink: "0" })}">${escape(formatDate(m.target_date))}</span>
        </div>`;
    }).join("");
    return `
      <div style="margin-bottom:24px">
        <div style="${s({ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" })}">
          <span style="${s({ fontSize: "0.6rem", fontWeight: 700, padding: "2px 8px", borderRadius: TOKENS.radiusFull, background: `${color}1A`, color, letterSpacing: "0.08em", textTransform: "uppercase" })}">${escape(g.domain)}</span>
          <span style="${s({ fontSize: "0.95rem", fontWeight: 600, color: TOKENS.colorText })}">${escape(g.name)}</span>
          <span style="${s({ marginLeft: "auto", fontSize: "0.7rem", color: TOKENS.colorTextMuted, fontVariantNumeric: "tabular-nums" })}">${completed}/${total} milestones</span>
        </div>
        <div style="${s({ position: "relative", display: "flex", flexDirection: "column", gap: "4px", paddingLeft: "24px" })}">
          <div style="${s({ position: "absolute", left: "10px", top: "6px", bottom: "6px", width: "2px", background: `linear-gradient(to bottom, ${color} 0%, ${color} ${pct}%, ${TOKENS.colorBorderLight} ${pct}%, ${TOKENS.colorBorderLight} 100%)`, borderRadius: "1px" })}"></div>
          ${nodes}
        </div>
      </div>`;
  }).join("");
}

function renderWeeklyReview(data: any): string {
  const narrative = String(data?.narrative ?? "");
  const stats = data?.agenda_stats ?? { completed: 0, skipped: 0, rescheduled: 0 };
  const habitHtml = renderHabitProgress(data?.habit_progress ?? { habits: [] });
  const goalHtml = renderGoalRoadmap(data?.goal_roadmap ?? { goals: [] });
  const sectionHeader = (label: string) =>
    `<div style="${s({ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: TOKENS.colorTextMuted, marginBottom: "8px", paddingBottom: "4px", borderBottom: `1px solid ${TOKENS.colorBorderLight}` })}">${label}</div>`;
  const statCard = (value: number, label: string, color: string) =>
    `<div style="${s({ background: TOKENS.colorSurface, border: `1px solid ${TOKENS.colorBorder}`, borderLeft: `3px solid ${color}`, borderRadius: TOKENS.radiusLg, padding: "16px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px" })}">
      <span style="${s({ fontSize: "1.6rem", fontWeight: 700, color: TOKENS.colorText, lineHeight: "1", fontVariantNumeric: "tabular-nums" })}">${value}</span>
      <span style="${s({ fontSize: "0.72rem", fontWeight: 600, color: TOKENS.colorTextMuted, textTransform: "uppercase", letterSpacing: "0.05em" })}">${label}</span>
    </div>`;
  return `
    <section>${sectionHeader("Summary")}<div style="${s({ fontSize: "0.95rem", lineHeight: "1.65", color: TOKENS.colorText, whiteSpace: "pre-wrap" })}">${renderInlineMarkdown(narrative)}</div></section>
    <section style="margin-top:32px">${sectionHeader("Agenda")}<div style="${s({ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" })}">
      ${statCard(Number(stats.completed ?? 0), "Completed", TOKENS.colorSuccess)}
      ${statCard(Number(stats.skipped ?? 0), "Skipped", TOKENS.colorWarning)}
      ${statCard(Number(stats.rescheduled ?? 0), "Rescheduled", TOKENS.colorInfo)}
    </div></section>
    <section style="margin-top:32px">${sectionHeader("Habits")}${habitHtml}</section>
    <section style="margin-top:32px">${sectionHeader("Goals")}${goalHtml}</section>`;
}

// ============================================================================
// SHELL (matches ArtifactShell visual contract)
// ============================================================================

const KIND_LABELS: Record<ArtifactKind, string> = {
  agenda_diff: "Agenda Diff",
  habit_progress: "Habit Progress",
  goal_roadmap: "Goal Roadmap",
  weekly_review: "Weekly Review",
};

function wrapInShell(kind: ArtifactKind, body: string, generatedAt: string): string {
  const color =
    kind === "habit_progress"
      ? TOKENS.domainWellness
      : kind === "goal_roadmap"
      ? TOKENS.colorAccent
      : TOKENS.colorPrimary;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'">
<title>Sage · ${escape(KIND_LABELS[kind])}</title>
<style>
  body { margin: 0; background: ${TOKENS.colorBackground}; font-family: ${TOKENS.fontSans}; color: ${TOKENS.colorText}; padding: 24px; }
  .artifact { max-width: 1280px; margin: 0 auto; background: ${TOKENS.colorSurface}; border: 1px solid ${TOKENS.colorBorder}; border-radius: ${TOKENS.radiusXl}; box-shadow: ${TOKENS.shadowMd}; overflow: hidden; }
  .artifact-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px; padding: 8px 16px; border-bottom: 1px solid ${TOKENS.colorBorderLight}; background: ${TOKENS.colorBackgroundAlt}; }
  .artifact-badge { display: inline-flex; align-items: center; background: ${color}1A; color: ${color}; border-radius: ${TOKENS.radiusFull}; padding: 2px 8px; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; white-space: nowrap; }
  .artifact-timestamp { font-size: 0.72rem; color: ${TOKENS.colorTextMuted}; white-space: nowrap; }
  .artifact-body { padding: 24px; }
  .artifact-footer { display: flex; align-items: center; gap: 4px; padding: 4px 16px; border-top: 1px solid ${TOKENS.colorBorderLight}; background: ${TOKENS.colorBackgroundAlt}; }
  .artifact-footer .caption { font-size: 0.7rem; color: ${TOKENS.colorTextMuted}; }
  .lp-emblem { width: 18px; height: 18px; flex-shrink: 0; }
</style>
</head>
<body>
  <div class="artifact">
    <div class="artifact-header">
      <span class="artifact-badge">${escape(KIND_LABELS[kind])}</span>
      <span class="artifact-timestamp">${escape(formatTimestamp(generatedAt))}</span>
    </div>
    <div class="artifact-body">${body}</div>
    <div class="artifact-footer">
      <svg class="lp-emblem" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="10" cy="10" r="10" fill="${TOKENS.colorPrimary}"/>
        <rect x="5" y="5" width="2" height="10" rx="1" fill="white"/>
        <rect x="5" y="5" width="6" height="2" rx="1" fill="white"/>
        <path d="M11 5h3a2 2 0 0 1 0 4h-3V5z" fill="white"/>
      </svg>
      <span class="caption">Generated by Sage</span>
    </div>
  </div>
</body>
</html>`;
}

// ============================================================================
// MAIN RENDERER
// ============================================================================

export function renderArtifactToHtml(artifact: ArtifactResult): string {
  const body = (() => {
    switch (artifact.kind) {
      case "agenda_diff":
        return renderAgendaDiff(artifact.data);
      case "habit_progress":
        return renderHabitProgress(artifact.data);
      case "goal_roadmap":
        return renderGoalRoadmap(artifact.data);
      case "weekly_review":
        return renderWeeklyReview(artifact.data);
      default:
        return `<pre>${escape(JSON.stringify(artifact.data, null, 2))}</pre>`;
    }
  })();
  const generatedAt = artifact.generated_at ?? new Date().toISOString();
  return wrapInShell(artifact.kind, body, generatedAt);
}

// ============================================================================
// STDIN READER (Deno std)
// ============================================================================

async function readAllStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = Deno.stdin.readable.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(merged);
}

// ============================================================================
// CLI COMMAND
// ============================================================================

export const renderArtifactCommand = new Command()
  .description(
    "Render a Sage plan artifact to a self-contained HTML file for Claude Code preview.",
  )
  .option("--stdin", "Read artifact JSON from stdin (default when no --from-tool-call).", {
    default: true,
  })
  .option(
    "--from-tool-call <id:string>",
    "Re-fetch the artifact by id via the MCP server (not implemented in v1).",
  )
  .option("--out <path:string>", "Output path (default: /tmp/lifeprint-artifact-<id>.html).")
  .action(async (options) => {
    if (options.fromToolCall) {
      console.error(
        "--from-tool-call is not implemented in v1. Pipe the tool result JSON on stdin instead.",
      );
      Deno.exit(2);
    }
    const jsonText = await readAllStdin();
    if (!jsonText.trim()) {
      console.error("No input on stdin. Pipe the JSON result of sage.render_plan_artifact.");
      Deno.exit(2);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      console.error(`Invalid JSON on stdin: ${(err as Error).message}`);
      Deno.exit(2);
    }
    // Accept both `{ ...artifact }` and the wrapped `{ result: artifact }`
    // shape the MCP server returns under structuredContent.
    const artifact: ArtifactResult = (() => {
      const p = parsed as any;
      if (p && typeof p === "object" && "kind" in p) return p as ArtifactResult;
      if (p?.structuredContent?.result?.kind) return p.structuredContent.result as ArtifactResult;
      if (p?.result?.kind) return p.result as ArtifactResult;
      throw new Error("Could not locate an artifact payload in the provided JSON.");
    })();

    if (!["agenda_diff", "habit_progress", "goal_roadmap", "weekly_review"].includes(artifact.kind)) {
      console.error(`Unknown artifact kind: ${artifact.kind}`);
      Deno.exit(2);
    }

    const id = sanitizeArtifactId(artifact.artifact_id);
    const outPath = options.out ?? `/tmp/lifeprint-artifact-${id}.html`;
    const html = renderArtifactToHtml(artifact);
    await Deno.writeTextFile(outPath, html);
    console.log(outPath);
  });
