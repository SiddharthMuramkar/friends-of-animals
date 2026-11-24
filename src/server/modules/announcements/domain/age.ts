import { isAdultAt } from "../../participants/domain/age";
import { parseIsoDate } from "../../registration/domain/calendar-date";

/** Unknown dates are treated as minors. Birthdays follow the Indian calendar. */
export function isUnder18On(dateOfBirth: string | null, at: Date): boolean {
  const birth = dateOfBirth === null ? null : parseIsoDate(dateOfBirth);
  return birth === null || !isAdultAt(birth, at);
}
