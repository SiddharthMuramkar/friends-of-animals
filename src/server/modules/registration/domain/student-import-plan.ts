// Which rows of a student import get enrolled (#76). Each row has already
// been checked by the single-student rules (#75); this decides the rest:
// a student already enrolled is skipped, and when the file holds the same
// student twice the first row is enrolled and every later one is reported
// against it, so nobody is added twice.
//
// Rows are matched by keys the caller makes, one per way of recognising a
// student (the roll number, the identity hash), each prefixed with its
// kind so different kinds never collide: "ref:…", "id:…". Existing keys are
// the same strings read from the enrolled students.
//
// Pure. Loads under plain Node.

export type PreparedImportRow<T, P> =
  | { ok: true; rowNumber: number; value: T; keys: readonly string[] }
  | { ok: false; rowNumber: number; problems: P[] };

export type SkippedImportRow<P> =
  | { rowNumber: number; kind: "invalid"; problems: P[] }
  | { rowNumber: number; kind: "duplicate_in_file"; duplicateOf: number }
  | { rowNumber: number; kind: "already_enrolled" };

export type StudentImportPlan<T, P> = {
  /** In file order. */
  toEnrol: { rowNumber: number; value: T; keys: readonly string[] }[];
  /** In file order. */
  skipped: SkippedImportRow<P>[];
};

export function planStudentImport<T, P>(
  rows: readonly PreparedImportRow<T, P>[],
  enrolledKeys: ReadonlySet<string>
): StudentImportPlan<T, P> {
  const plan: StudentImportPlan<T, P> = { toEnrol: [], skipped: [] };
  /** Each key in the file so far, and the first row that had it. */
  const firstRowWith = new Map<string, number>();

  for (const row of rows) {
    if (!row.ok) {
      plan.skipped.push({
        rowNumber: row.rowNumber,
        kind: "invalid",
        problems: row.problems,
      });
      continue;
    }
    if (row.keys.some((key) => enrolledKeys.has(key))) {
      plan.skipped.push({ rowNumber: row.rowNumber, kind: "already_enrolled" });
      continue;
    }
    const earlier = row.keys
      .map((key) => firstRowWith.get(key))
      .find((rowNumber) => rowNumber !== undefined);
    if (earlier !== undefined) {
      plan.skipped.push({
        rowNumber: row.rowNumber,
        kind: "duplicate_in_file",
        duplicateOf: earlier,
      });
      continue;
    }
    for (const key of row.keys) firstRowWith.set(key, row.rowNumber);
    plan.toEnrol.push({
      rowNumber: row.rowNumber,
      value: row.value,
      keys: row.keys,
    });
  }
  return plan;
}

/** What became of one row. A planned row can still end up already enrolled. */
export type StudentImportOutcomeKind =
  | "enrolled"
  | SkippedImportRow<unknown>["kind"];

export type StudentImportCounts = {
  total: number;
  enrolled: number;
  notEnrolled: number;
  invalid: number;
  duplicateInFile: number;
  alreadyEnrolled: number;
};

/** The counts the import's audit row and its summary carry. */
export function summariseStudentImport(
  outcomes: readonly { rowNumber: number; kind: StudentImportOutcomeKind }[]
): StudentImportCounts {
  const count = (kind: StudentImportOutcomeKind) =>
    outcomes.filter((outcome) => outcome.kind === kind).length;
  const enrolled = count("enrolled");
  return {
    total: outcomes.length,
    enrolled,
    notEnrolled: outcomes.length - enrolled,
    invalid: count("invalid"),
    duplicateInFile: count("duplicate_in_file"),
    alreadyEnrolled: count("already_enrolled"),
  };
}

export type EnrolledRowOutcome<R> =
  | { rowNumber: number; kind: "enrolled"; result: R }
  | { rowNumber: number; kind: "already_enrolled" };

/**
 * Enrols the planned rows one after another. `enrolOne` writes one
 * student whole (profile, registration and its audit row, in its own
 * savepoint) or not at all. A row that breaks the one-active-registration
 * index was enrolled by someone else since the plan was made, so it is
 * reported as already enrolled; any other failure stops here and is passed
 * on, so the caller's transaction rolls the whole import back.
 */
export async function enrolPlannedRows<T, R>(
  rows: readonly { rowNumber: number; value: T }[],
  enrolOne: (value: T) => Promise<R>,
  isConflict: (error: unknown) => boolean
): Promise<EnrolledRowOutcome<R>[]> {
  const outcomes: EnrolledRowOutcome<R>[] = [];
  for (const row of rows) {
    try {
      const result = await enrolOne(row.value);
      outcomes.push({ rowNumber: row.rowNumber, kind: "enrolled", result });
    } catch (error) {
      if (!isConflict(error)) throw error;
      outcomes.push({ rowNumber: row.rowNumber, kind: "already_enrolled" });
    }
  }
  return outcomes;
}
