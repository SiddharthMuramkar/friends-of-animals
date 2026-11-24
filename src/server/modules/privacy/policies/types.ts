// What a retention policy is to the sweep (#114). The engine (../sweep.ts)
// owns the cutoff, legal holds, floors, batching, counts, dry runs and the
// audit row; a policy only says which rows are past their period and how
// to remove them. Callers see `runRetentionSweep()`; tests see counts and
// rows.
//
// Loads under plain Node: relative imports only, no "server-only".

import type { BlindIndex } from "../../../crypto/blind-index";
import type { FieldCipher } from "../../../crypto/field-cipher";
import type { AppDb } from "../../../db/app-db";
import type { ObjectStorage } from "../../../ports/storage";
import type { CONTACT_RETENTION, TimedPolicyKey } from "../domain/periods";
import type {
  RetentionAction,
  RetentionCandidate,
} from "../domain/retention-plan";

export type CandidateCursor = {
  id: string;
  /** Exact database timestamp for policies ordered by expiry. */
  anchor?: string;
};

/** One batch of candidates after `after`, at most `limit`. */
export type CandidateQuery = {
  now: Date;
  /** Rows anchored at or before this instant are past their period. */
  cutoff: Date;
  /** The configured period for a calendar policy. */
  months?: number | undefined;
  /** The last row scanned in the previous page; null for the first. */
  after: CandidateCursor | null;
  limit: number;
  blindIndex: BlindIndex;
  cipher: FieldCipher;
};

export type CandidatePage = {
  candidates: readonly RetentionCandidate[];
  /** The next cursor comes from the scan, even if no rows were eligible. */
  next: CandidateCursor | null;
};

export function nextCursor(rows: readonly { id: string }[], limit: number) {
  const last = rows.at(-1);
  return last && rows.length === limit ? { id: last.id } : null;
}

export type RetentionPolicy = {
  /** camelCase; a timed policy's setting is `retention.<key>Days`. */
  key: string;
  /** The table whose rows the policy removes or blanks. */
  table: string;
  action: RetentionAction;
  /**
   * Timed: the period is the policy's setting, counted from each row's
   * anchor. Calendar: the module applies a runtime month count. Fixed:
   * the owning module decides when a row may go (a
   * computed date), and each candidate's anchor is that instant.
   */
  period:
    | { kind: "timed"; key: TimedPolicyKey }
    | { kind: "calendar"; settingKey: typeof CONTACT_RETENTION.settingKey }
    | { kind: "fixed" };
  /**
   * Scan a page in cursor order, with eligible rows and the subjects a
   * legal hold may name. Runs in the batch's transaction and locks its rows.
   */
  candidates(db: AppDb, query: CandidateQuery): Promise<CandidatePage>;
  /** Changes exactly these rows, or stages intent for an object purge. */
  apply(
    db: AppDb,
    ids: readonly string[],
    candidates: readonly RetentionCandidate[]
  ): Promise<void>;
  /** Completes one staged purge under a fresh legal-hold lock. */
  finishDeletion?(
    this: void,
    db: AppDb,
    id: string,
    storage: ObjectStorage
  ): Promise<"deleted" | "held" | "skipped">;
};
