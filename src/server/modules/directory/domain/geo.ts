// Places and distances for the directory search (#128). The search query
// measures distance in plain SQL (../search.ts), not with Postgres's
// earthdistance extension, which waits on HR-60; this file holds the same
// maths in TypeScript, for tests and for the rules around a visitor's
// location. Both use earthdistance's sphere, so moving the query onto
// earthdistance later changes no result.
//
// A listing's position is the centre of its pin code, never its address,
// so distances are approximate by a few kilometres and are shown that way.
//
// Loads under plain Node: no "server-only", no `@/` imports.

export type GeoPoint = { latitude: number; longitude: number };

/**
 * earthdistance's `earth()`: the sphere, in metres, that `ll_to_earth()`
 * and `earth_distance()` work on. The SQL in ../search.ts uses it too.
 */
export const EARTH_RADIUS_METRES = 6378168;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** `ll_to_earth()`: the point on the sphere, as x, y, z in metres. */
function onSphere({ latitude, longitude }: GeoPoint): [number, number, number] {
  const lat = radians(latitude);
  const lng = radians(longitude);
  return [
    EARTH_RADIUS_METRES * Math.cos(lat) * Math.cos(lng),
    EARTH_RADIUS_METRES * Math.cos(lat) * Math.sin(lng),
    EARTH_RADIUS_METRES * Math.sin(lat),
  ];
}

/**
 * The great-circle distance in metres, as the search's SQL and
 * `earth_distance(ll_to_earth(a), ll_to_earth(b))` compute it: the
 * straight-line chord between the two points, turned into the arc over it
 * (the haversine formula by another route).
 */
export function earthDistanceMetres(a: GeoPoint, b: GeoPoint): number {
  const [ax, ay, az] = onSphere(a);
  const [bx, by, bz] = onSphere(b);
  const chord = Math.hypot(ax - bx, ay - by, az - bz);
  const half = chord / (2 * EARTH_RADIUS_METRES);
  if (half >= 1) return Math.PI * EARTH_RADIUS_METRES;
  return 2 * EARTH_RADIUS_METRES * Math.asin(half);
}

/**
 * A box around India, islands included. Pin codes and searches outside it
 * are mistakes: a post office with its coordinates swapped, or a visitor
 * abroad.
 */
export const INDIA_BOUNDS = {
  minLatitude: 6,
  maxLatitude: 37.1,
  minLongitude: 68,
  maxLongitude: 97.5,
} as const;

export function isInIndia({ latitude, longitude }: GeoPoint): boolean {
  return (
    latitude >= INDIA_BOUNDS.minLatitude &&
    latitude <= INDIA_BOUNDS.maxLatitude &&
    longitude >= INDIA_BOUNDS.minLongitude &&
    longitude <= INDIA_BOUNDS.maxLongitude
  );
}

/**
 * Decimal places kept from a visitor's location: two is about 1.1 km. The
 * search URL carries the location, and request logs keep URLs, so it never
 * holds more than a neighbourhood. Listings sit at pin-code centres a few
 * kilometres across, so no result moves by more than that.
 */
export const LOCATION_DECIMALS = 2;

const LOCATION_SCALE = 10 ** LOCATION_DECIMALS;

const coarsen = (degrees: number) =>
  Math.round(degrees * LOCATION_SCALE) / LOCATION_SCALE;

/** `point` rounded to LOCATION_DECIMALS. */
export function coarsenLocation(point: GeoPoint): GeoPoint {
  return {
    latitude: coarsen(point.latitude),
    longitude: coarsen(point.longitude),
  };
}

/**
 * How a distance is shown. Under 1 km reads "under 1 km"; up to 10 km to
 * one decimal; further in whole kilometres. More precision would claim an
 * accuracy pin-code centres don't have.
 */
export type ApproximateDistance =
  | { kind: "under"; km: 1 }
  | { kind: "about"; km: number };

export function approximateDistance(metres: number): ApproximateDistance {
  if (metres < 999.5) return { kind: "under", km: 1 };
  const km =
    metres < 9950 ? Math.round(metres / 100) / 10 : Math.round(metres / 1000);
  return { kind: "about", km };
}

export type GeoBox = {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
};

/**
 * A latitude-longitude box holding every point within `metres` of
 * `centre`, with a little to spare. The search narrows to it with plain
 * comparisons (an index on latitude) before measuring each distance. Near
 * the poles it widens to every longitude; India is far from them.
 */
export function boxAround(centre: GeoPoint, metres: number): GeoBox {
  const degrees = ((metres / EARTH_RADIUS_METRES) * 180) / Math.PI;
  const latSpan = degrees * 1.01;
  const cosLat = Math.cos(radians(centre.latitude));
  const lngSpan = cosLat < 0.01 ? 180 : Math.min(180, latSpan / cosLat);
  return {
    minLatitude: centre.latitude - latSpan,
    maxLatitude: centre.latitude + latSpan,
    minLongitude: centre.longitude - lngSpan,
    maxLongitude: centre.longitude + lngSpan,
  };
}
