/** Pure helpers for the doodle pad (no DOM, unit-tested). */

export type Point = { x: number; y: number };

const r = (n: number) => Math.round(n * 100) / 100;
const avg = (a: number, b: number) => r((a + b) / 2);

/** perfect-freehand's outline → an SVG path (the README's quadratic form). */
export function outlineToPath(outline: number[][]): string {
  if (outline.length < 4) return "";
  const [p0, p1, p2] = outline as [number[], number[], number[]];
  let d = `M${r(p0[0]!)},${r(p0[1]!)} Q${r(p1[0]!)},${r(p1[1]!)} ${avg(p1[0]!, p2[0]!)},${avg(p1[1]!, p2[1]!)} T`;
  for (let i = 2; i < outline.length - 1; i++) {
    const a = outline[i]!;
    const b = outline[i + 1]!;
    d += `${avg(a[0]!, b[0]!)},${avg(a[1]!, b[1]!)} `;
  }
  return `${d}Z`;
}

const STEP = 10;
const BIG_STEP = 40;
const MOVES: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Keyboard stamp cursor: arrows move it (Shift = bigger steps), clamped. */
export function moveCursor(
  at: Point,
  key: string,
  shift: boolean,
  box: { width: number; height: number }
): Point | null {
  const move = MOVES[key];
  if (!move) return null;
  const step = shift ? BIG_STEP : STEP;
  return {
    x: Math.min(box.width, Math.max(0, at.x + move[0] * step)),
    y: Math.min(box.height, Math.max(0, at.y + move[1] * step)),
  };
}
