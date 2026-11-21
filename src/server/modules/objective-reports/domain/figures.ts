// How objective reports state a figure (#135): a share as a percentage to
// one decimal place, and a figure set against the period before. Counts are
// whole numbers, so the rounding is done in integers: half a tenth rounds
// away from zero, and 1 in 2000 is 0.1%, not 0.0% through binary drift.
//
// Pure: no imports.

function requireCount(value: number, name: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a whole number >= 0, got ${value}`);
  }
  return BigInt(value);
}

/** `part` as a percentage of `whole`, to 0.1; null when `whole` is 0. */
export function percentOf(part: number, whole: number): number | null {
  const p = requireCount(part, "part");
  const w = requireCount(whole, "whole");
  if (w === 0n) return null;
  // Tenths of a percent, rounded half up: floor((2 * p * 1000 + w) / 2w).
  const tenths = (2n * p * 1000n + w) / (2n * w);
  return Number(tenths) / 10;
}

export type Comparison = {
  current: number;
  previous: number;
  /** `current - previous`. */
  delta: number;
  /** The change as a percentage of `previous`, to 0.1; null if it was 0. */
  percent: number | null;
};

/** `current` set against `previous`, the same figure one period earlier. */
export function compareWithPrevious(
  current: number,
  previous: number
): Comparison {
  requireCount(current, "current");
  const delta = current - previous;
  const size = percentOf(Math.abs(delta), previous);
  const percent = size === null || delta >= 0 || size === 0 ? size : -size;
  return { current, previous, delta, percent };
}
