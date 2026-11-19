import { cn } from "@/lib/utils";

// Paw prints in the tile colours, wandering up and off the edge: the page
// "has wandered off". Plain SVG with no image or client code, because the
// root not-found tree ships with every route (#45).
const PRINTS = [
  { x: 52, y: 292, fill: "fill-red-600" },
  { x: 96, y: 236, fill: "fill-green-500" },
  { x: 126, y: 170, fill: "fill-blue-700" },
  { x: 170, y: 114, fill: "fill-yellow-300" },
  { x: 198, y: 50, fill: "fill-teal-400" },
] as const;

const TOES = [
  [-10, -6],
  [-4, -12],
  [4, -12],
  [10, -6],
] as const;

/** Decorative. */
export function PawTrail({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 240 340"
      className={cn("h-auto w-full max-w-xs", className)}
    >
      {PRINTS.map(({ x, y, fill }, i) => (
        <g
          key={fill}
          className={fill}
          // Left and right feet alternate; later prints fade.
          transform={`translate(${x} ${y}) rotate(${i % 2 ? 40 : 28}) scale(1.6)`}
          opacity={1 - i * 0.15}
        >
          <ellipse cx={0} cy={5} rx={9} ry={7.5} />
          {TOES.map(([cx, cy]) => (
            <circle key={cx} cx={cx} cy={cy} r={3.6} />
          ))}
        </g>
      ))}
    </svg>
  );
}
