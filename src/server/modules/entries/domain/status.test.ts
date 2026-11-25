import { describe, expect, it } from "vitest";

import {
  canMoveEntry,
  canMoveEntryFile,
  ENTRY_FILE_STATUSES,
  ENTRY_STATUSES,
  EntryTransitionError,
  moveEntry,
  moveEntryFile,
  type EntryFileStatus,
  type EntryStatus,
} from "./status";

// Every allowed move, written out by hand so a change to the table in
// status.ts has to change this list too. Every other pair is forbidden.
const ALLOWED_ENTRY_MOVES: ReadonlyArray<[EntryStatus | null, EntryStatus]> = [
  [null, "processing"],
  ["processing", "submitted"],
  ["processing", "rejected"],
  ["processing", "failed"],
  ["rejected", "processing"],
  ["failed", "processing"],
  // The school round is finalised (#89): a picked entry is shortlisted and
  // goes straight on to FOA; every other entry is not shortlisted.
  ["submitted", "school_shortlisted"],
  // Also the shortlist-only path (#91): a created entry goes on to FOA once
  // its upload is live and its round is finished.
  ["school_shortlisted", "submitted_to_foa"],
  ["processing", "not_shortlisted"],
  ["rejected", "not_shortlisted"],
  ["failed", "not_shortlisted"],
  ["submitted", "not_shortlisted"],
  // A typed essay (#86).
  [null, "submitted"],
  // Shortlist-only scope (#91): the coordinator creates the entry in the
  // school round, already shortlisted. No upload outcome moves it, and it
  // is never not_shortlisted.
  [null, "school_shortlisted"],
];

const ALLOWED_FILE_MOVES: ReadonlyArray<
  [EntryFileStatus | null, EntryFileStatus]
> = [
  [null, "pending"],
  // A typed essay (#86).
  [null, "live"],
  ["pending", "processing"],
  ["pending", "rejected"],
  ["processing", "live"],
  ["processing", "failed"],
  ["pending", "superseded"],
  ["processing", "superseded"],
  ["live", "superseded"],
];

const key = (from: string | null, to: string) => `${from ?? "(new)"} -> ${to}`;

describe("entry statuses", () => {
  it("has every status the digital rounds use, from the start", () => {
    expect(ENTRY_STATUSES).toEqual([
      "processing",
      "submitted",
      "rejected",
      "failed",
      "school_shortlisted",
      "not_shortlisted",
      "submitted_to_foa",
      "foa_verified",
      "sent_back",
    ]);
  });

  const allowed = new Set(ALLOWED_ENTRY_MOVES.map(([f, t]) => key(f, t)));
  const pairs = [null, ...ENTRY_STATUSES].flatMap((from) =>
    ENTRY_STATUSES.map((to) => [from, to] as const)
  );

  it.each(pairs.filter(([f, t]) => allowed.has(key(f, t))))(
    "allows %s -> %s",
    (from, to) => {
      expect(canMoveEntry(from, to)).toBe(true);
      expect(moveEntry(from, to)).toBe(to);
    }
  );

  it.each(pairs.filter(([f, t]) => !allowed.has(key(f, t))))(
    "forbids %s -> %s",
    (from, to) => {
      expect(canMoveEntry(from, to)).toBe(false);
      expect(() => moveEntry(from, to)).toThrow(EntryTransitionError);
    }
  );

  it("names both ends of a refused move", () => {
    const error = (() => {
      try {
        moveEntry("rejected", "submitted");
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(EntryTransitionError);
    expect(error).toMatchObject({
      code: "invalid_transition",
      machine: "entry",
      from: "rejected",
      to: "submitted",
    });
  });
});

describe("entry file statuses", () => {
  it("tracks each uploaded file apart from its entry", () => {
    expect(ENTRY_FILE_STATUSES).toEqual([
      "pending",
      "processing",
      "live",
      "rejected",
      "failed",
      "superseded",
    ]);
  });

  const allowed = new Set(ALLOWED_FILE_MOVES.map(([f, t]) => key(f, t)));
  const pairs = [null, ...ENTRY_FILE_STATUSES].flatMap((from) =>
    ENTRY_FILE_STATUSES.map((to) => [from, to] as const)
  );

  it.each(pairs.filter(([f, t]) => allowed.has(key(f, t))))(
    "allows %s -> %s",
    (from, to) => {
      expect(canMoveEntryFile(from, to)).toBe(true);
      expect(moveEntryFile(from, to)).toBe(to);
    }
  );

  it.each(pairs.filter(([f, t]) => !allowed.has(key(f, t))))(
    "forbids %s -> %s",
    (from, to) => {
      expect(canMoveEntryFile(from, to)).toBe(false);
      expect(() => moveEntryFile(from, to)).toThrow(EntryTransitionError);
    }
  );
});
