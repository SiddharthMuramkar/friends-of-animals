// Who is told about a prize when results publish (#99): one award per line
// that holds an award band, with the competition's prize text for that band
// (#72). Finalists and special mentions get no prize message. Messages about
// minors reach their guardians through the notifications module (#81).
//
// Plain TypeScript, loads under plain Node.

import type { SnapshotLine } from "./snapshot";

export type PrizeAward = {
  entryId: string;
  participantProfileId: string;
  band: string;
  /** The prize text for the band, or null when none is set. */
  prize: string | null;
};

/** The prize awards for `lines`, in snapshot order. */
export function prizeAwards(
  lines: readonly SnapshotLine[],
  prizes: Partial<Record<string, string>>
): PrizeAward[] {
  return lines.flatMap((line) =>
    line.awardBand === null
      ? []
      : [
          {
            entryId: line.entryId,
            participantProfileId: line.participantProfileId,
            band: line.awardBand,
            prize: prizes[line.awardBand] ?? null,
          },
        ]
  );
}
