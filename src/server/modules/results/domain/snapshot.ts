// The results snapshot (#99): the exact award lines of a competition's final
// round that a release publishes, in one canonical order, and the hashes that
// prove the published content is what the second person approved.
//
// Loads under plain Node: only `node:crypto`.

import { createHash } from "node:crypto";

/** The outcomes that appear in results, best first. */
export const RESULTS_OUTCOMES = [
  "winner",
  "runner_up",
  "finalist",
  "special_mention",
] as const;

export type ResultsOutcome = (typeof RESULTS_OUTCOMES)[number];

/** A round entry's tagged outcome as the judging module (#97) reports it. */
export type RoundAwardLine = {
  entryId: string;
  entryCode: string;
  participantProfileId: string;
  discipline: string;
  ageGroup: string;
  outcome: ResultsOutcome | "none";
  /** 1-3 for a placed winner or runner-up; null otherwise. */
  awardPosition: 1 | 2 | 3 | null;
};

/** One line of a release: a round award line with its award band. */
export type SnapshotLine = {
  entryId: string;
  entryCode: string;
  participantProfileId: string;
  discipline: string;
  ageGroup: string;
  outcome: ResultsOutcome;
  awardPosition: 1 | 2 | 3 | null;
  /** The award scheme's band for the position (`first`, `gold`, ...). */
  awardBand: string | null;
};

const OUTCOME_ORDER: Record<ResultsOutcome, number> = {
  winner: 0,
  runner_up: 1,
  finalist: 2,
  special_mention: 3,
};

// Code-unit comparison, so the order never depends on the server's locale.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareLines(a: SnapshotLine, b: SnapshotLine): number {
  return (
    compareText(a.discipline, b.discipline) ||
    compareText(a.ageGroup, b.ageGroup) ||
    (a.awardPosition ?? 4) - (b.awardPosition ?? 4) ||
    OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] ||
    compareText(a.entryCode, b.entryCode)
  );
}

function bandFor(
  line: RoundAwardLine,
  bands: readonly string[]
): string | null {
  if (line.outcome !== "winner" && line.outcome !== "runner_up") return null;
  if (line.awardPosition === null) return null;
  return bands[line.awardPosition - 1] ?? null;
}

/**
 * The lines a release publishes: every entry with an outcome, each placed
 * winner or runner-up given the band of `bands` (the round's award scheme,
 * best first) for its position, sorted by discipline, age group, position,
 * outcome and entry code. Throws if an entry appears twice.
 */
export function snapshotLines(
  round: readonly RoundAwardLine[],
  bands: readonly string[]
): SnapshotLine[] {
  const seen = new Set<string>();
  const lines: SnapshotLine[] = [];
  for (const entry of round) {
    if (seen.has(entry.entryId)) {
      throw new Error(`Entry ${entry.entryId} appears more than once`);
    }
    seen.add(entry.entryId);
    if (entry.outcome === "none") continue;
    lines.push({
      entryId: entry.entryId,
      entryCode: entry.entryCode,
      participantProfileId: entry.participantProfileId,
      discipline: entry.discipline,
      ageGroup: entry.ageGroup,
      outcome: entry.outcome,
      awardPosition: entry.awardPosition,
      awardBand: bandFor(entry, bands),
    });
  }
  return lines.sort(compareLines);
}

// Rebuilds each line with a fixed key order, so the JSON (and the hash)
// never depends on how a line object was put together or read back.
function canonicalLines(lines: readonly SnapshotLine[]) {
  return lines.map((line) => ({
    entryId: line.entryId,
    entryCode: line.entryCode,
    participantProfileId: line.participantProfileId,
    discipline: line.discipline,
    ageGroup: line.ageGroup,
    outcome: line.outcome,
    awardPosition: line.awardPosition,
    awardBand: line.awardBand,
  }));
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The hash of the lines alone: compares a snapshot with the live round. */
export function linesHash(lines: readonly SnapshotLine[]): string {
  return sha256(JSON.stringify(canonicalLines(lines)));
}

/** Everything a second person approves when they approve a release. */
export type ReleaseContent = {
  competitionId: string;
  sourceRoundId: string;
  publishAt: Date | null;
  deliveryNote: string | null;
  lines: readonly SnapshotLine[];
};

/**
 * The hash stored on a release. It covers the lines, the publish time and
 * the delivery note, so approval and the publish job can each prove nothing
 * changed since it was computed.
 */
export function releaseContentHash(content: ReleaseContent): string {
  return sha256(
    JSON.stringify({
      format: 1,
      competitionId: content.competitionId,
      sourceRoundId: content.sourceRoundId,
      publishAt: content.publishAt?.toISOString() ?? null,
      deliveryNote: content.deliveryNote,
      lines: canonicalLines(content.lines),
    })
  );
}
