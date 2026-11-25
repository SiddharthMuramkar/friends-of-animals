// Exact fractions for scores. A sheet total divides by criterion ranges
// and weights, and an entry's score is a mean of sheet totals, so floats
// would make two equal scores differ in the last bit and decide a tie by
// rounding noise. Rankings compare these exactly; pages show 2 decimals.
//
// Loads under plain Node: relative imports only.

/** num/den in lowest terms; den is always positive. */
export type Rational = { readonly num: bigint; readonly den: bigint };

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function toBigInt(value: number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${value} is not a safe integer`);
  }
  return BigInt(value);
}

function reduce(num: bigint, den: bigint): Rational {
  if (den === 0n) throw new RangeError("A fraction can't have 0 below");
  const sign = den < 0n ? -1n : 1n;
  const divisor = gcd(num, den) || 1n;
  return { num: (sign * num) / divisor, den: (sign * den) / divisor };
}

/** The fraction num/den, reduced. */
export function rational(num: number | bigint, den: number | bigint = 1) {
  return reduce(toBigInt(num), toBigInt(den));
}

/** The sum of every value given; 0 for none. */
export function addRationals(...values: readonly Rational[]): Rational {
  return values.reduce(
    (sum, value) =>
      reduce(sum.num * value.den + value.num * sum.den, sum.den * value.den),
    rational(0)
  );
}

export function multiplyRational(value: Rational, by: number | bigint) {
  return reduce(value.num * toBigInt(by), value.den);
}

export function divideRational(value: Rational, by: number | bigint) {
  return reduce(value.num, value.den * toBigInt(by));
}

/** -1, 0 or 1, like a sort comparator: a below, equal to, or above b. */
export function compareRationals(a: Rational, b: Rational): -1 | 0 | 1 {
  const left = a.num * b.den;
  const right = b.num * a.den;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** `value` with `places` decimals, halves rounded away from zero. */
export function formatRational(value: Rational, places = 2): string {
  const negative = value.num < 0n;
  const scale = 10n ** BigInt(places);
  const magnitude = negative ? -value.num : value.num;
  const scaled = (magnitude * scale * 2n + value.den) / (value.den * 2n);
  const whole = (scaled / scale).toString();
  const fraction = (scaled % scale).toString().padStart(places, "0");
  const text = places === 0 ? whole : `${whole}.${fraction}`;
  return negative && scaled !== 0n ? `-${text}` : text;
}
