// Turns India Post's "All India Pincode Directory" (data.gov.in, Government
// Open Data Licence - India) into one centre per pin code (#128). The file
// lists post offices, several per pin code, and some have no coordinates or
// wrong ones. The import script reads the CSV, calls this, and upserts the
// result into `pincode_location`, so running it again changes nothing.
//
// Takes records already split by a CSV reader, header first, so this file
// holds only the rules.
//
// Loads under plain Node: no "server-only", no `@/` imports.

import { isInIndia, type GeoPoint } from "./geo";

export type PincodeCentre = GeoPoint & {
  pinCode: string;
  /** The district most of its post offices name, or null. */
  district: string | null;
  /** The state most of its post offices name, or null. */
  state: string | null;
  /** Post offices with usable coordinates behind the centre. */
  postOffices: number;
};

export type PincodeSkipReason = "bad_pin" | "no_coordinates" | "outside_india";

export type PincodeColumn = "pincode" | "latitude" | "longitude";

export type PincodeImport =
  | {
      ok: true;
      /** Sorted by pin code. */
      centres: PincodeCentre[];
      /** Post-office rows read, blank lines aside. */
      rows: number;
      skipped: Record<PincodeSkipReason, number>;
    }
  | { ok: false; reason: "missing_column"; column: PincodeColumn };

/** Header names seen in the dataset's layouts, lower-case letters only. */
const COLUMNS = {
  pincode: ["pincode", "pin"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "long", "lng", "lon"],
  district: ["district", "districtname"],
  state: ["statename", "state"],
} as const;

const PIN_CODE = /^[1-9]\d{5}$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;
const MISSING = new Set(["", "na", "n/a", "null", "-"]);
const SMALL_WORDS = new Set(["and", "of"]);

const headerKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");

function columnIndex(header: readonly string[], names: readonly string[]) {
  const keys = header.map(headerKey);
  return keys.findIndex((key) => names.includes(key));
}

function decimal(raw: string): number | null {
  const value = raw.trim();
  return DECIMAL.test(value) ? Number(value) : null;
}

/**
 * The dataset writes places in capitals ("JAMMU AND KASHMIR"); people read
 * "Jammu and Kashmir". Names already in mixed case are kept as written.
 */
function placeName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (MISSING.has(name.toLowerCase())) return null;
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .split(" ")
    .map((word, index) =>
      index > 0 && SMALL_WORDS.has(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2;
  // Six decimals is about 10 cm; it hides float noise from the average.
  return Math.round(value * 1e6) / 1e6;
}

/** The most common name, the first-seen on a tie; null if none. */
function mostCommon(names: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const name of names) {
    if (name !== null) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [name, count] of counts) {
    if (best === null || count > counts.get(best)!) best = name;
  }
  return best;
}

type Offices = {
  points: GeoPoint[];
  districts: (string | null)[];
  states: (string | null)[];
};

export function pincodeCentres(
  records: readonly (readonly string[])[]
): PincodeImport {
  const [header = [], ...body] = records;
  const at = {
    pincode: columnIndex(header, COLUMNS.pincode),
    latitude: columnIndex(header, COLUMNS.latitude),
    longitude: columnIndex(header, COLUMNS.longitude),
    district: columnIndex(header, COLUMNS.district),
    state: columnIndex(header, COLUMNS.state),
  };
  for (const column of ["pincode", "latitude", "longitude"] as const) {
    if (at[column] === -1) {
      return { ok: false, reason: "missing_column", column };
    }
  }

  const cell = (record: readonly string[], index: number) =>
    index === -1 ? "" : (record[index] ?? "");
  const skipped: Record<PincodeSkipReason, number> = {
    bad_pin: 0,
    no_coordinates: 0,
    outside_india: 0,
  };
  const byPin = new Map<string, Offices>();
  let rows = 0;

  for (const record of body) {
    if (record.every((value) => value.trim() === "")) continue;
    rows += 1;
    const pinCode = cell(record, at.pincode).trim();
    if (!PIN_CODE.test(pinCode)) {
      skipped.bad_pin += 1;
      continue;
    }
    const latitude = decimal(cell(record, at.latitude));
    const longitude = decimal(cell(record, at.longitude));
    if (latitude === null || longitude === null) {
      skipped.no_coordinates += 1;
      continue;
    }
    const point = { latitude, longitude };
    if (!isInIndia(point)) {
      skipped.outside_india += 1;
      continue;
    }
    const offices = byPin.get(pinCode) ?? {
      points: [],
      districts: [],
      states: [],
    };
    offices.points.push(point);
    offices.districts.push(placeName(cell(record, at.district)));
    offices.states.push(placeName(cell(record, at.state)));
    byPin.set(pinCode, offices);
  }

  const centres = [...byPin]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([pinCode, offices]) => ({
      pinCode,
      latitude: median(offices.points.map((point) => point.latitude)),
      longitude: median(offices.points.map((point) => point.longitude)),
      district: mostCommon(offices.districts),
      state: mostCommon(offices.states),
      postOffices: offices.points.length,
    }));
  return { ok: true, centres, rows, skipped };
}
