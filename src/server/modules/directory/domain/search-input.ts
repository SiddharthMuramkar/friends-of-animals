// Reads a directory search (#128) from the /ngos search form's query
// string: where from (a pin code, or the browser's location), which
// service, how far. Every bad field gets its own error code, so the form
// can show them all at once.
//
// The service list comes in from the caller (the directory catalogue owns
// it), so this file stays free of the listing model.
//
// Loads under plain Node: no "server-only", no `@/` imports.

import { coarsenLocation, isInIndia, type GeoPoint } from "./geo";

/**
 * The radii the form offers, in kilometres. A constant until FOA asks to
 * tune them; then they move to the settings screen (#62).
 */
export const RADIUS_OPTIONS_KM = [5, 10, 25, 50] as const;

export type RadiusKm = (typeof RADIUS_OPTIONS_KM)[number];

export const DEFAULT_RADIUS_KM: RadiusKm = 10;

/**
 * Where a search starts. A location is already coarsened (geo.ts), so the
 * precise one never reaches a query, a log or an error report.
 */
export type SearchOrigin =
  | { kind: "pin"; pinCode: string }
  | { kind: "point"; point: GeoPoint };

export type DirectorySearch<Service extends string> = {
  origin: SearchOrigin;
  /** Null searches every service. */
  service: Service | null;
  radiusKm: RadiusKm;
};

export type SearchField = "pin" | "location" | "service" | "radius";

export type SearchFieldError = "required" | "invalid" | "outside_india";

export type SearchInputResult<Service extends string> =
  | { ok: true; value: DirectorySearch<Service> }
  | { ok: false; errors: Partial<Record<SearchField, SearchFieldError>> };

const PIN_CODE = /^[1-9]\d{5}$/;
const DEGREES = /^-?\d{1,3}(\.\d+)?$/;
const WHOLE_NUMBER = /^\d+$/;

type Field<T> = { ok: true; value: T } | { ok: false; error: SearchFieldError };

const fail = (error: SearchFieldError): Field<never> => ({ ok: false, error });

/**
 * A query-string value, trimmed: "" when absent, null when it isn't one
 * string (a repeated parameter arrives as an array).
 */
function text(raw: unknown): string | null {
  if (raw === undefined || raw === null) return "";
  return typeof raw === "string" ? raw.trim() : null;
}

function degrees(raw: string | null, limit: number): number | null {
  if (raw === null || !DEGREES.test(raw)) return null;
  const value = Number(raw);
  return Math.abs(value) <= limit ? value : null;
}

function origin(input: Record<string, unknown>): {
  field: "pin" | "location";
  result: Field<SearchOrigin>;
} {
  const pin = text(input.pin)?.replace(/\s/g, "") ?? null;
  if (pin === null) return { field: "pin", result: fail("invalid") };
  if (pin !== "") {
    return {
      field: "pin",
      result: PIN_CODE.test(pin)
        ? { ok: true, value: { kind: "pin", pinCode: pin } }
        : fail("invalid"),
    };
  }

  const lat = text(input.lat);
  const lng = text(input.lng);
  if (lat === "" && lng === "") {
    return { field: "pin", result: fail("required") };
  }
  const latitude = degrees(lat, 90);
  const longitude = degrees(lng, 180);
  if (latitude === null || longitude === null) {
    return { field: "location", result: fail("invalid") };
  }
  const point = coarsenLocation({ latitude, longitude });
  return {
    field: "location",
    result: isInIndia(point)
      ? { ok: true, value: { kind: "point", point } }
      : fail("outside_india"),
  };
}

function service<Service extends string>(
  raw: unknown,
  services: readonly Service[]
): Field<Service | null> {
  const value = text(raw);
  if (value === "") return { ok: true, value: null };
  return value !== null && (services as readonly string[]).includes(value)
    ? { ok: true, value: value as Service }
    : fail("invalid");
}

function radius(raw: unknown): Field<RadiusKm> {
  const value = text(raw);
  if (value === "") return { ok: true, value: DEFAULT_RADIUS_KM };
  if (value === null || !WHOLE_NUMBER.test(value)) return fail("invalid");
  const km = Number(value);
  return (RADIUS_OPTIONS_KM as readonly number[]).includes(km)
    ? { ok: true, value: km as RadiusKm }
    : fail("invalid");
}

/**
 * Reads `raw` (searchParams: `pin`, `lat`, `lng`, `service`, `radius`). A
 * typed pin code wins over a location still in the form.
 */
export function parseDirectorySearch<const Service extends string>(
  raw: unknown,
  services: readonly Service[]
): SearchInputResult<Service> {
  const input: Record<string, unknown> =
    typeof raw === "object" && raw !== null ? { ...raw } : {};
  const from = origin(input);
  const fields = {
    service: service(input.service, services),
    radius: radius(input.radius),
  };

  const errors: Partial<Record<SearchField, SearchFieldError>> = {};
  if (!from.result.ok) errors[from.field] = from.result.error;
  if (!fields.service.ok) errors.service = fields.service.error;
  if (!fields.radius.ok) errors.radius = fields.radius.error;

  if (!from.result.ok || !fields.service.ok || !fields.radius.ok) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      origin: from.result.value,
      service: fields.service.value,
      radiusKm: fields.radius.value,
    },
  };
}
