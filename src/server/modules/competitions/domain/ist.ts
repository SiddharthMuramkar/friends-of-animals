// Admins enter key dates in IST; the database stores exact instants. India
// has kept UTC+05:30 all year since 1945, with no daylight saving, so the
// conversion is a fixed offset.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** What <input type="datetime-local"> submits: no zone, seconds optional. */
const LOCAL_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export type IstInstantResult =
  | { ok: true; at: Date }
  | { ok: false; error: "invalid_date" };

/** Reads a datetime-local value ("2027-01-15T10:00") as IST. */
export function istLocalToInstant(local: string): IstInstantResult {
  const match = LOCAL_DATE_TIME.exec(local);
  if (!match) return { ok: false, error: "invalid_date" };
  const [year, month, day, hour, minute, second = 0] = match
    .slice(1)
    .map((part) => (part === undefined ? undefined : Number(part)));
  const asUtc = new Date(
    Date.UTC(year!, month! - 1, day!, hour!, minute!, second)
  );
  // Date.UTC rolls over (30 February becomes 2 March), so a value that
  // doesn't read back the same never existed.
  const exists =
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month! - 1 &&
    asUtc.getUTCDate() === day &&
    asUtc.getUTCHours() === hour &&
    asUtc.getUTCMinutes() === minute;
  if (!exists) return { ok: false, error: "invalid_date" };
  return { ok: true, at: new Date(asUtc.getTime() - IST_OFFSET_MS) };
}

/** The IST datetime-local value ("2027-01-15T10:00") for an instant. */
export function instantToIstLocal(at: Date): string {
  const ms = at.getTime();
  if (Number.isNaN(ms)) throw new RangeError("instantToIstLocal: invalid Date");
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 16);
}
