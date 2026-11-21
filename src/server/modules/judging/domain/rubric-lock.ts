// When rubrics stop changing. Once a competition enters school judging,
// schools score against the published rubrics, so no discipline gets a new
// draft, revision or published version from then on (HR-37: FOA to
// confirm). Statuses added later in the timeline (FOA judging, results)
// lock them too.
//
// Loads under plain Node (seed script): relative imports only.

import {
  COMPETITION_STATUSES,
  type CompetitionStatus,
} from "../../competitions/domain/vocabulary";

const SCHOOL_JUDGING = COMPETITION_STATUSES.indexOf("school_judging");

/** Whether a competition in `status` still takes rubric changes. */
export function rubricsLocked(status: CompetitionStatus): boolean {
  return COMPETITION_STATUSES.indexOf(status) >= SCHOOL_JUDGING;
}
