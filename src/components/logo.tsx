import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

type LogoProps = {
  /** Classes for the image itself: size only. Never round or crop it. */
  className?: string;
  /** Classes for the wrapping plate: padding, rounding, layout. */
  plateClassName?: string;
};

/**
 * The registered FOA logo, unaltered (see public/brand/README.md). In dark
 * mode it sits on a white plate so the black wordmark stays legible. Padding
 * and rounding go on the plate, never on the image, so nothing clips the mark.
 * Decorative (`alt=""`): name the organisation in nearby text, such as a link
 * label or a heading.
 */
export function Logo({ className, plateClassName }: LogoProps) {
  return (
    <span className={cn("inline-block dark:bg-white", plateClassName)}>
      {/* oxlint-disable-next-line nextjs/no-img-element -- SVG master, nothing to optimise */}
      <img
        src={SITE.logo.src}
        alt=""
        width={SITE.logo.width}
        height={SITE.logo.height}
        className={cn("block", className)}
      />
    </span>
  );
}
