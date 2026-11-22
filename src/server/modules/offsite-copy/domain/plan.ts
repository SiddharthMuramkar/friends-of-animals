// What one night's copy does to one production bucket, decided from a
// complete R2 listing and the manifest of what B2 already holds.

import { nonProductionPrefixOf } from "./keys";

/** An object as a complete R2 listing reports it; etag normalised. */
export type SourceObject = {
  key: string;
  etag: string;
  sizeBytes: number;
  lastModified: Date;
};

/** A manifest row: an object B2 holds a copy of. */
export type ManifestEntry = {
  key: string;
  etag: string;
  sizeBytes: number;
  /** When a run first found it gone from R2; null while it's there. */
  deletedInSourceAt: Date | null;
};

/** How long B2 keeps a copy after its object leaves R2. */
export type RetentionWindow = { days: number };

export type CopyReason = "new" | "changed";

export type OffsitePlan = {
  /** Objects to copy to B2, in listing order. */
  copy: { object: SourceObject; reason: CopyReason }[];
  /** Back in R2 unchanged before their copy was purged: unmark them. */
  clearDeleted: string[];
  /** Gone from R2 since the last run: mark them now, keep their copies. */
  markDeleted: string[];
  /** Gone from R2 for the whole retention window: delete their copies. */
  purge: string[];
  /** Gone from R2, still inside the retention window. */
  held: number;
  /** Objects B2 already holds as they are. */
  unchanged: number;
  /** Keys under a staging, local or preview prefix: never copied. */
  skippedNonProduction: number;
  /**
   * Set when the listing can't be trusted: then nothing is marked or
   * purged. `empty_listing`: no production object listed while B2 holds
   * live copies, as a wrong bucket or token would show.
   */
  refused: "empty_listing" | null;
  /** True when this run marks unusually many copies: worth a warning. */
  massDeletion: boolean;
};

/** A run marking more than this share of the live copies is flagged... */
const MASS_DELETION_SHARE = 0.1;
/** ...if it marks at least this many, so small buckets stay quiet. */
const MASS_DELETION_MIN = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The window is counted from the first run that found the object gone, so
 * a copy outlives its object by the window plus up to one night.
 */
function purgeIsDue(
  deletedInSourceAt: Date,
  now: Date,
  retention: RetentionWindow
): boolean {
  return now.getTime() >= deletedInSourceAt.getTime() + retention.days * DAY_MS;
}

function assertRetention(retention: RetentionWindow): void {
  if (!Number.isInteger(retention.days) || retention.days < 1) {
    throw new RangeError(
      `The retention window must be a whole number of days from 1, not ${retention.days}`
    );
  }
}

export function planOffsiteCopy(input: {
  source: readonly SourceObject[];
  manifest: readonly ManifestEntry[];
  now: Date;
  retention: RetentionWindow;
}): OffsitePlan {
  assertRetention(input.retention);
  const copiedByKey = new Map(input.manifest.map((row) => [row.key, row]));
  const listed = new Set<string>();
  const plan: OffsitePlan = {
    copy: [],
    clearDeleted: [],
    markDeleted: [],
    purge: [],
    held: 0,
    unchanged: 0,
    skippedNonProduction: 0,
    refused: null,
    massDeletion: false,
  };

  for (const object of input.source) {
    if (listed.has(object.key)) {
      throw new Error(`The listing names ${object.key} twice`);
    }
    listed.add(object.key);
    if (nonProductionPrefixOf(object.key) !== null) {
      plan.skippedNonProduction += 1;
      continue;
    }
    const copy = copiedByKey.get(object.key);
    if (copy === undefined) {
      plan.copy.push({ object, reason: "new" });
    } else if (
      copy.etag !== object.etag ||
      copy.sizeBytes !== object.sizeBytes
    ) {
      plan.copy.push({ object, reason: "changed" });
    } else if (copy.deletedInSourceAt !== null) {
      plan.clearDeleted.push(object.key);
    } else {
      plan.unchanged += 1;
    }
  }

  const live = input.manifest.filter((row) => row.deletedInSourceAt === null);
  const productionListed = listed.size - plan.skippedNonProduction;
  if (productionListed === 0 && live.length > 0) {
    plan.refused = "empty_listing";
    return plan;
  }

  for (const copy of input.manifest) {
    if (listed.has(copy.key)) continue;
    if (copy.deletedInSourceAt === null) {
      plan.markDeleted.push(copy.key);
    } else if (purgeIsDue(copy.deletedInSourceAt, input.now, input.retention)) {
      plan.purge.push(copy.key);
    } else {
      plan.held += 1;
    }
  }
  plan.massDeletion =
    plan.markDeleted.length >= MASS_DELETION_MIN &&
    plan.markDeleted.length > live.length * MASS_DELETION_SHARE;
  return plan;
}
