// The public results view (#99): what `/competitions/[slug]/results` shows
// for a published release, grouped by discipline and age group, each line
// with only the credit its consents allow (#82). Credits fail closed: a line
// the resolver said nothing about, or a credit without a name, shows as
// withheld. Nothing but the award, the entry code and the credit leaves.
//
// Plain TypeScript, loads under plain Node.

/** A published line, as the release snapshot (99a) holds it. */
export type PublicResultLine = {
  entryId: string;
  entryCode: string;
  discipline: string;
  ageGroup: string;
  outcome: "winner" | "runner_up" | "finalist" | "special_mention";
  awardPosition: 1 | 2 | 3 | null;
  awardBand: string | null;
};

/** What a person may be credited as in public (#82's resolver). */
export type PublicCredit =
  | { kind: "withheld" }
  | {
      kind: "credited";
      name: string;
      school: string | null;
      city: string | null;
    };

export type PublicLine = {
  entryCode: string;
  outcome: PublicResultLine["outcome"];
  awardBand: string | null;
  credit: PublicCredit;
};

export type PublicCategory = {
  ageGroup: string;
  /** Winners and runners-up, by position. */
  placed: PublicLine[];
  specialMentions: PublicLine[];
  finalists: PublicLine[];
};

export type PublicDiscipline = {
  discipline: string;
  categories: PublicCategory[];
};

const WITHHELD: PublicCredit = { kind: "withheld" };

// Rebuilds the credit from its public fields only, so nothing else the
// resolver's object carries can reach the page.
function publicCredit(credit: PublicCredit | undefined): PublicCredit {
  if (credit?.kind !== "credited") return WITHHELD;
  const name = credit.name.trim();
  if (name.length === 0) return WITHHELD;
  return {
    kind: "credited",
    name,
    school: credit.school,
    city: credit.city,
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Positions in the given order first, then any value the order doesn't
// know, in the order it first appeared.
function orderBy(known: readonly string[], values: Iterable<string>): string[] {
  const present = new Set(values);
  return [
    ...known.filter((value) => present.has(value)),
    ...[...present].filter((value) => !known.includes(value)),
  ];
}

function category(
  ageGroup: string,
  lines: readonly PublicResultLine[],
  credits: ReadonlyMap<string, PublicCredit>
): PublicCategory {
  const toPublic = (line: PublicResultLine): PublicLine => ({
    entryCode: line.entryCode,
    outcome: line.outcome,
    awardBand: line.awardBand,
    credit: publicCredit(credits.get(line.entryId)),
  });
  const byCode = (a: PublicResultLine, b: PublicResultLine) =>
    compareText(a.entryCode, b.entryCode);
  const of = (outcomes: readonly PublicResultLine["outcome"][]) =>
    lines.filter((line) => outcomes.includes(line.outcome));
  return {
    ageGroup,
    placed: of(["winner", "runner_up"])
      .sort(
        (a, b) =>
          (a.awardPosition ?? 4) - (b.awardPosition ?? 4) || byCode(a, b)
      )
      .map(toPublic),
    specialMentions: of(["special_mention"]).sort(byCode).map(toPublic),
    finalists: of(["finalist"]).sort(byCode).map(toPublic),
  };
}

/**
 * The page's results: disciplines and age groups in the competition's order
 * (`disciplines`, `ageGroups`), any others after them, and each line's
 * credit from `credits`, keyed by entry id.
 */
export function publicResultsView(input: {
  disciplines: readonly string[];
  ageGroups: readonly string[];
  lines: readonly PublicResultLine[];
  credits: ReadonlyMap<string, PublicCredit>;
}): PublicDiscipline[] {
  const { lines, credits } = input;
  return orderBy(
    input.disciplines,
    lines.map((line) => line.discipline)
  ).map((discipline) => {
    const inDiscipline = lines.filter((line) => line.discipline === discipline);
    return {
      discipline,
      categories: orderBy(
        input.ageGroups,
        inDiscipline.map((line) => line.ageGroup)
      ).map((ageGroup) =>
        category(
          ageGroup,
          inDiscipline.filter((line) => line.ageGroup === ageGroup),
          credits
        )
      ),
    };
  });
}

/** Whether a competition's results are out, coming, or not scheduled. */
export type ResultsState =
  | { state: "published" }
  | { state: "scheduled"; publishAt: Date }
  | { state: "none" };

/** A `cacheLife` profile, in seconds. */
export type CacheLifetime = {
  stale: number;
  revalidate: number;
  expire: number;
};

/** The client router keeps an entry at least this long (Next's minimum). */
const CLIENT_STALE = 30;

/** How long published results stand before credits are read again. */
const REVALIDATE = 60;

/**
 * How long the page's results section may be cached. Published results and
 * "none" are re-read within a minute, so a consent withdrawal shows quickly
 * without the worker revalidating anything. A scheduled release is re-read
 * at its publish instant (at most a minute ahead), and every second once the
 * instant has passed but the publish job hasn't run yet.
 */
export function resultsCacheLife(
  state: ResultsState,
  now: Date
): CacheLifetime {
  if (state.state !== "scheduled") {
    return { stale: CLIENT_STALE, revalidate: REVALIDATE, expire: 300 };
  }
  const untilPublish = Math.ceil(
    (state.publishAt.getTime() - now.getTime()) / 1000
  );
  const revalidate = Math.min(REVALIDATE, Math.max(1, untilPublish));
  return { stale: CLIENT_STALE, revalidate, expire: revalidate + 1 };
}
