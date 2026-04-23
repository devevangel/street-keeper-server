/**
 * Deterministic share copy for run celebrations (Strava description preview / write).
 * No DB access — pure functions only.
 */

/** Base footer line (no leading newlines). */
export const STREET_KEEPER_HASHTAG_BASE = "#StreetKeeper #RunEveryStreet";

/** Legacy export: base footer with leading newlines (used when appending combined Strava block). */
export const STREET_KEEPER_HASHTAG_FOOTER = `\n\n${STREET_KEEPER_HASHTAG_BASE}`;

/** Regex to strip our footer from a stored message, including optional contextual hashtags. */
export const STREET_KEEPER_HASHTAG_FOOTER_STRIP_RE =
  /\n\n#StreetKeeper #RunEveryStreet(?:\s+#[A-Za-z0-9_]+)*\s*$/u;

export type CelebrationStoryline =
  | "project-finished"
  | "long-run"
  | "early-bird"
  | "nighthawk"
  | "minimalist"
  | "multi-project"
  | "single-street"
  | "completion-heavy"
  | "discovery-heavy"
  | "grinder";

export interface BuildShareMessageInput {
  activityId: string;
  projectId: string;
  projectName: string;
  sameRunProjectCount: number;
  completedCount: number;
  startedCount: number;
  improvedCount: number;
  completedStreetNames: string[];
  startedStreetNames: string[];
  improvedStreetNames: string[];
  projectProgressBefore: number;
  projectProgressAfter: number;
  projectCompleted: boolean;
  activityDistanceMeters: number;
  activityDurationSeconds: number;
  /** Activity start instant (UTC from DB); hour-of-day uses `userTimeZone`. */
  activityStartDate: Date;
  /** IANA zone (e.g. `Europe/London`). Defaults to UTC when missing. */
  userTimeZone?: string;
}

function hashSeed(activityId: string, projectId: string): number {
  const s = `${activityId}:${projectId}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function pickVariant<T>(variants: readonly T[], seed: number): T {
  return variants[seed % variants.length]!;
}

function formatDistanceKm(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
  }
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function streetListSummary(names: string[], maxShow: number): string {
  const uniq = [...new Set(names.filter(Boolean))];
  if (uniq.length === 0) return "";
  const shown = uniq.slice(0, maxShow);
  const rest = uniq.length - shown.length;
  const tail = rest > 0 ? ` (+${rest} more)` : "";
  return shown.join(", ") + tail;
}

/** Local hour 0–23 in `timeZone` (falls back to UTC on invalid zone). */
export function getLocalHour(date: Date, timeZone: string | undefined): number {
  const zone = timeZone?.trim() || "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: zone,
    }).formatToParts(date);
    const hourPart = parts.find((p) => p.type === "hour");
    if (hourPart?.value != null) {
      const h = parseInt(hourPart.value, 10);
      if (!Number.isNaN(h)) return h;
    }
  } catch {
    /* invalid IANA */
  }
  return date.getUTCHours();
}

function pickStoryline(input: BuildShareMessageInput): CelebrationStoryline {
  const totalStreets =
    input.completedCount + input.startedCount + input.improvedCount;
  const tz = input.userTimeZone;
  const hour = getLocalHour(input.activityStartDate, tz);

  if (input.projectCompleted) return "project-finished";
  if (input.activityDistanceMeters >= 10_000) return "long-run";
  if (input.sameRunProjectCount >= 2) return "multi-project";
  if (hour < 7) return "early-bird";
  if (hour >= 21) return "nighthawk";
  if (totalStreets <= 2 && input.activityDistanceMeters >= 3000) {
    return "minimalist";
  }
  if (totalStreets === 1) return "single-street";
  if (
    input.completedCount > 0 &&
    input.completedCount >= input.startedCount &&
    input.completedCount >= input.improvedCount
  ) {
    return "completion-heavy";
  }
  if (
    input.startedCount > 0 &&
    input.startedCount >= input.completedCount &&
    input.startedCount >= input.improvedCount
  ) {
    return "discovery-heavy";
  }
  return "grinder";
}

function buildHashtagFooterSuffix(storyline: CelebrationStoryline): string {
  const extra: Record<CelebrationStoryline, string | null> = {
    "project-finished": "#ProjectDone",
    "long-run": "#LongRun",
    "early-bird": "#MorningRun",
    nighthawk: "#NightRun",
    minimalist: "#QuickHit",
    "multi-project": null,
    "single-street": null,
    "completion-heavy": null,
    "discovery-heavy": null,
    grinder: null,
  };
  const tag = extra[storyline];
  if (tag) {
    return `\n\n${STREET_KEEPER_HASHTAG_BASE} ${tag}`;
  }
  return STREET_KEEPER_HASHTAG_FOOTER;
}

/**
 * Build the full Strava-ready message (including hashtag footer).
 * Deterministic for the same activityId + projectId.
 */
export function buildShareMessage(input: BuildShareMessageInput): string {
  const seed = hashSeed(input.activityId, input.projectId);
  const storyline = pickStoryline(input);
  const dist = formatDistanceKm(input.activityDistanceMeters);
  const dur = formatDuration(input.activityDurationSeconds);
  const proj = input.projectName;
  const pctBefore = input.projectProgressBefore.toFixed(0);
  const pctAfter = input.projectProgressAfter.toFixed(0);

  const completedLine = streetListSummary(input.completedStreetNames, 8);
  const startedLine = streetListSummary(input.startedStreetNames, 8);
  const improvedLine = streetListSummary(input.improvedStreetNames, 8);

  const lines: string[] = ["--- Street Keeper ---"];

  switch (storyline) {
    case "project-finished": {
      const variants = [
        () =>
          `You finished every street in "${proj}". That is a serious flex.\n\n${dist} · ${dur}`,
        () =>
          `Project complete: "${proj}". Every street — done.\n\n${dist} · ${dur}`,
        () =>
          `"${proj}" is 100% complete. Time to pick the next map to conquer.\n\n${dist} · ${dur}`,
        () =>
          `Full clear: "${proj}". Nothing left to run here.\n\n${dist} · ${dur}`,
        () =>
          `Street-by-street, you emptied "${proj}". Huge.\n\n${dist} · ${dur}`,
      ];
      lines.push(pickVariant(variants, seed)());
      break;
    }
    case "long-run": {
      const variants = [
        () =>
          `Long miles, big map moves — "${proj}" felt every step.\n\n${dist} · ${dur} · ${pctBefore}% → ${pctAfter}%`,
        () =>
          `You stacked distance and still moved "${proj}" forward.\n\n${dist} · ${dur}`,
        () =>
          `Endurance day: "${proj}" now at ${pctAfter}%.\n\n${dist} · ${dur}`,
        () =>
          `Serious distance on the legs; "${proj}" shifted (${pctBefore}% → ${pctAfter}%).\n\n${dist} · ${dur}`,
        () =>
          `A long run that paid rent on "${proj}".\n\n${dist} · ${dur} · ${pctAfter}%`,
      ];
      lines.push(pickVariant(variants, seed)());
      break;
    }
    case "early-bird": {
      const variants = [
        () =>
          `Early light, early wins — "${proj}" before the city woke up.\n\n${dist} · ${dur} · ${pctBefore}% → ${pctAfter}%`,
        () =>
          `Morning miles moved "${proj}" to ${pctAfter}%.\n\n${dist} · ${dur}`,
        () =>
          `Beat the alarm, beat the grid: "${proj}" ticked forward.\n\n${dist} · ${dur}`,
        () =>
          `Sunrise session — "${proj}" is warmer now.\n\n${dist} · ${dur}`,
        () =>
          `Quiet streets, loud progress in "${proj}".\n\n${dist} · ${dur} · ${pctAfter}%`,
      ];
      lines.push(pickVariant(variants, seed)());
      break;
    }
    case "nighthawk": {
      const variants = [
        () =>
          `Night shift on the map — "${proj}" after dark.\n\n${dist} · ${dur} · ${pctBefore}% → ${pctAfter}%`,
        () =>
          `Headlamp energy: "${proj}" climbed to ${pctAfter}%.\n\n${dist} · ${dur}`,
        () =>
          `Late run, real progress in "${proj}".\n\n${dist} · ${dur}`,
        () =>
          `The city cooled down; "${proj}" heated up.\n\n${dist} · ${dur} · ${pctAfter}%`,
        () =>
          `After-hours miles banked in "${proj}".\n\n${dist} · ${dur}`,
      ];
      lines.push(pickVariant(variants, seed)());
      break;
    }
    case "minimalist": {
      const variants = [
        () =>
          `Lean run, sharp delta — "${proj}" moved without a crowd of streets.\n\n${dist} · ${dur} · ${pctBefore}% → ${pctAfter}%`,
        () =>
          `Few touches, high signal in "${proj}".\n\n${dist} · ${dur}`,
        () =>
          `Tight session: "${proj}" at ${pctAfter}%.\n\n${dist} · ${dur}`,
        () =>
          `Small footprint, big shift for "${proj}".\n\n${dist} · ${dur}`,
        () =>
          `Minimal streets, maximum intent in "${proj}".\n\n${dist} · ${dur} · ${pctAfter}%`,
      ];
      lines.push(pickVariant(variants, seed)());
      break;
    }
    case "multi-project": {
      const variants = [
        () =>
          `One run, multiple projects moved — "${proj}" is part of the haul.\n\n${dist} · ${dur} · ${pctBefore}% → ${pctAfter}%`,
        () =>
          `Crossed projects today; "${proj}" ticked forward (${pctBefore}% → ${pctAfter}%).\n\n${dist} · ${dur}`,
        () =>
          `Multi-map energy: "${proj}" now at ${pctAfter}%.\n\n${dist} · ${dur}`,
        () =>
          `You threaded projects in one outing — "${proj}" among them (${pctAfter}%).\n\n${dist} · ${dur}`,
        () =>
          `Big day on the map: "${proj}" climbed to ${pctAfter}%.\n\n${dist} · ${dur}`,
      ];
      lines.push(pickVariant(variants, seed)());
      break;
    }
    case "single-street": {
      const name =
        input.completedStreetNames[0] ??
        input.startedStreetNames[0] ??
        input.improvedStreetNames[0] ??
        "one street";
      const variants = [
        () => `Focused work: ${name} in "${proj}".\n\n${dist} · ${dur}`,
        () => `Short run, sharp impact — ${name} (${proj}).\n\n${dist} · ${dur}`,
        () => `One street, one story: ${name} · ${proj}.\n\n${dist} · ${dur}`,
        () => `Kept it tight: ${name} moved in "${proj}".\n\n${dist} · ${dur}`,
        () => `Precision pass on ${name} (${proj}).\n\n${dist} · ${dur}`,
      ];
      lines.push(pickVariant(variants, seed)());
      break;
    }
    case "completion-heavy": {
      const variants = [
        () =>
          `New streets finished in "${proj}" — momentum is real.\n\n${dist} · ${dur} · ${pctBefore}% → ${pctAfter}%`,
        () =>
          `Checked off completions in "${proj}" (${pctAfter}% overall).\n\n${dist} · ${dur}`,
        () =>
          `Completion mode: "${proj}" now at ${pctAfter}%.\n\n${dist} · ${dur}`,
        () =>
          `You banked finishes in "${proj}" today.\n\n${dist} · ${dur} · ${pctBefore}% → ${pctAfter}%`,
        () =>
          `Streets ticked to "done" in "${proj}".\n\n${dist} · ${dur}`,
      ];
      lines.push(pickVariant(variants, seed)());
      break;
    }
    case "discovery-heavy": {
      const variants = [
        () =>
          `Opened new lines in "${proj}" — fresh streets on the board.\n\n${dist} · ${dur} · ${pctBefore}% → ${pctAfter}%`,
        () =>
          `Exploration run: "${proj}" grew to ${pctAfter}%.\n\n${dist} · ${dur}`,
        () =>
          `First touches and new coverage in "${proj}".\n\n${dist} · ${dur}`,
        () =>
          `Discovery day for "${proj}" (${pctAfter}%).\n\n${dist} · ${dur}`,
        () =>
          `New segments logged in "${proj}".\n\n${dist} · ${dur} · ${pctBefore}% → ${pctAfter}%`,
      ];
      lines.push(pickVariant(variants, seed)());
      break;
    }
    case "grinder":
    default: {
      const variants = [
        () =>
          `Progress stack in "${proj}": chipped away without needing a headline stat.\n\n${dist} · ${dur} · ${pctBefore}% → ${pctAfter}%`,
        () =>
          `Quiet grind — "${proj}" moved to ${pctAfter}%.\n\n${dist} · ${dur}`,
        () =>
          `Incremental gains in "${proj}" add up.\n\n${dist} · ${dur}`,
        () =>
          `Kept the map moving in "${proj}" (${pctAfter}%).\n\n${dist} · ${dur}`,
        () =>
          `Solid work in "${proj}": ${pctBefore}% → ${pctAfter}%.\n\n${dist} · ${dur}`,
      ];
      lines.push(pickVariant(variants, seed)());
      break;
    }
  }

  if (completedLine) {
    lines.push("");
    lines.push(`Completed: ${completedLine}`);
  }
  if (startedLine) {
    lines.push("");
    lines.push(`Started: ${startedLine}`);
  }
  if (improvedLine) {
    lines.push("");
    lines.push(`Improved: ${improvedLine}`);
  }

  lines.push(buildHashtagFooterSuffix(storyline));
  return lines.join("\n");
}

/** Exposed for tests — storyline classification only */
export function pickStorylineForTest(input: BuildShareMessageInput): CelebrationStoryline {
  return pickStoryline(input);
}
