// Retention for legal holds themselves (#114): a released hold stays a
// year as the record of who held what and why, then goes.
//
// Loads under plain Node: relative imports only, no "server-only".

import { isNotNull } from "drizzle-orm";

import { legalHold } from "../../../db/schema";
import { rowPolicy } from "./define";

export const RELEASED_LEGAL_HOLDS = rowPolicy({
  key: "releasedLegalHolds",
  table: legalHold,
  action: "delete",
  period: "releasedLegalHolds",
  anchor: legalHold.releasedAt,
  where: isNotNull(legalHold.releasedAt),
  subjects: [[legalHold.subjectType, legalHold.subjectId]],
});
