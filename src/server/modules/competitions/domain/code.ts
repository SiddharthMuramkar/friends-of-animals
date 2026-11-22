// The competition code: 3 to 6 letters plus a two-digit year (PAWS27), set
// by an admin. Registration numbers, entry ids and artwork ids embed it.

export const COMPETITION_CODE_PATTERN = /^[A-Z]{3,6}\d{2}$/;

export type CompetitionCodeResult =
  | { ok: true; code: string }
  | { ok: false; error: "invalid_code" };

/** Trims and upper-cases `raw`, then checks the format. */
export function parseCompetitionCode(raw: string): CompetitionCodeResult {
  const code = raw.trim().toUpperCase();
  return COMPETITION_CODE_PATTERN.test(code)
    ? { ok: true, code }
    : { ok: false, error: "invalid_code" };
}
