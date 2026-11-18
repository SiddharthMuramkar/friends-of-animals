import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

type LogoProps = {
  /** Classes for the image: its size, and the plate's padding and rounding. */
  className?: string;
  /**
   * Classes for a wrapping span that carries the plate instead of the image.
   * The image is then not rounded, so the plate's rounding can't clip the
   * logo's corners.
   */
  plateClassName?: string;
};

/**
 * The registered FOA logo, unaltered (see public/brand/README.md). In dark
 * mode it sits on a white plate so the black wordmark stays legible.
 * Decorative (`alt=""`): name the organisation in nearby text, such as a link
 * label or a heading.
 */
export function Logo({ className, plateClassName }: LogoProps) {
  const plate = "dark:bg-white";
  const image = (
    // oxlint-disable-next-line nextjs/no-img-element -- SVG master, nothing to optimise
    <img
      src={SITE.logo.src}
      alt=""
      width={SITE.logo.width}
      height={SITE.logo.height}
      className={cn(className, plateClassName === undefined && plate)}
    />
  );
  if (plateClassName === undefined) return image;
  return <span className={cn(plateClassName, plate)}>{image}</span>;
}
