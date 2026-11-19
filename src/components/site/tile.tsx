import { cn } from "@/lib/utils";

/** The six tile colours: the logo's three, plus their additive mixes. */
export type TileHue = "red" | "green" | "blue" | "yellow" | "teal" | "pink";

const TILE_BG: Record<TileHue, string> = {
  red: "bg-red-600",
  green: "bg-green-500",
  blue: "bg-blue-700",
  yellow: "bg-yellow-300",
  teal: "bg-teal-400",
  pink: "bg-pink-400",
};

const SIZE = { sm: "size-3", md: "size-4", lg: "size-6" } as const;

/**
 * One rounded-square tile, the site's motif (corner radius 22%, like the
 * logo's tiles). Plain colour, never a letter: a lone logo tile is not
 * approved. Decorative.
 */
export function TileMarker({
  hue = "blue",
  size = "md",
  className,
}: {
  hue?: TileHue;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0 rounded-[22%]",
        TILE_BG[hue],
        SIZE[size],
        className
      )}
    />
  );
}

/** Three tiles in logo order between two hairlines. Decorative. */
export function TileDivider({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("flex items-center gap-3 text-border", className)}
    >
      <span className="h-px flex-1 bg-current" />
      <TileMarker hue="red" size="sm" />
      <TileMarker hue="green" size="sm" />
      <TileMarker hue="blue" size="sm" />
      <span className="h-px flex-1 bg-current" />
    </div>
  );
}
