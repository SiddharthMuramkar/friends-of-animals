// Which rubric versions an FOA round judges on (#95): the published
// version of every discipline the competition enables. A round is pinned
// when it is created and again when it opens, then never changes, so a
// later revision of a rubric doesn't move a round that is being judged.
//
// Loads under plain Node (seed script): relative imports only.

/** The parts of a rubric version pinning looks at. */
export type RubricVersion<Discipline extends string> = {
  id: string;
  discipline: Discipline;
  version: number;
  status: "draft" | "published" | "superseded";
};

export type RubricPin<Discipline extends string> = {
  discipline: Discipline;
  rubricId: string;
  version: number;
};

export type RubricPinning<Discipline extends string> =
  /** One pin per enabled discipline, in the order they are enabled. */
  | { ok: true; pins: RubricPin<Discipline>[] }
  /**
   * The enabled disciplines without a published rubric, in order. Empty
   * when the competition enables none, which a round can't judge either.
   */
  | { ok: false; missing: Discipline[] };

export function pinRubrics<Discipline extends string>(
  enabled: readonly Discipline[],
  rubrics: readonly RubricVersion<Discipline>[]
): RubricPinning<Discipline> {
  const published = new Map<Discipline, RubricVersion<Discipline>>();
  for (const rubric of rubrics) {
    if (rubric.status !== "published") continue;
    const current = published.get(rubric.discipline);
    if (!current || rubric.version > current.version) {
      published.set(rubric.discipline, rubric);
    }
  }
  const disciplines = [...new Set(enabled)];
  if (disciplines.length === 0) return { ok: false, missing: [] };
  const missing = disciplines.filter(
    (discipline) => !published.has(discipline)
  );
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    pins: disciplines.map((discipline) => {
      const rubric = published.get(discipline)!;
      return { discipline, rubricId: rubric.id, version: rubric.version };
    }),
  };
}
