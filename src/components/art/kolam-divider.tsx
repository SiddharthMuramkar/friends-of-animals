import { cn } from "@/lib/utils";

import styles from "./art.module.css";

const DOT_FILL = [
  "fill-red-600",
  "fill-yellow-300",
  "fill-green-600",
  "fill-teal-400",
  "fill-blue-600",
  "fill-pink-400",
] as const;

/**
 * One unbroken kolam line around a row of dots, the way a rice-flour
 * border is drawn on a doorstep: two strands weave over and under the dots
 * and loop back at each end. Deterministic, so server and client agree.
 */
export function kolamPath(dots: number, gap = 24) {
  const mid = gap / 2;
  const bulge = gap * 0.5;
  const width = dots * gap;
  const strand = (startUp: boolean, reverse: boolean) => {
    const parts: string[] = [];
    for (let k = 0; k < dots; k++) {
      const i = reverse ? dots - 1 - k : k;
      const up = (i % 2 === 0) === startUp;
      const y = up ? mid - bulge : mid + bulge;
      const [from, to] = reverse
        ? [(i + 1) * gap, i * gap]
        : [i * gap, (i + 1) * gap];
      const lean = reverse ? -gap * 0.08 : gap * 0.08;
      parts.push(`C${from + lean} ${y} ${to - lean} ${y} ${to} ${mid}`);
    }
    return parts.join(" ");
  };
  const loop = gap * 0.75;
  return [
    `M0 ${mid}`,
    strand(true, false),
    `C${width + loop} ${mid - bulge} ${width + loop} ${mid + bulge} ${width} ${mid}`,
    strand(false, true),
    `C${-loop} ${mid + bulge} ${-loop} ${mid - bulge} 0 ${mid}`,
  ].join(" ");
}

/**
 * A kolam border between sections: decorative, drawn by default, and drawn
 * stroke by stroke as it scrolls into view when motion is allowed.
 */
export function KolamDivider({
  dots = 9,
  className,
}: {
  dots?: number;
  className?: string;
}) {
  const gap = 24;
  const pad = gap * 0.9;
  const width = dots * gap;
  return (
    <div
      aria-hidden="true"
      className={cn("flex justify-center", styles.kolamFrame, className)}
    >
      <svg
        viewBox={`${-pad} ${-2} ${width + pad * 2} ${gap + 4}`}
        className="h-7 w-auto max-w-full overflow-visible text-ink-muted sm:h-8"
        focusable="false"
      >
        <path
          d={kolamPath(dots, gap)}
          pathLength={1}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={styles.kolam}
        />
        {Array.from({ length: dots }, (_, i) => (
          <circle
            key={i}
            cx={(i + 0.5) * gap}
            cy={gap / 2}
            r={2.6}
            className={cn(DOT_FILL[i % DOT_FILL.length], styles.kolamDot)}
            style={{ transformOrigin: `${(i + 0.5) * gap}px ${gap / 2}px` }}
          />
        ))}
      </svg>
    </div>
  );
}
