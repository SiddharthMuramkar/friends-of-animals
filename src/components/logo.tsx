import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

type LogoProps = {
  /** Classes for the image itself: size only. Never round or crop it. */
  className?: string;
  /** Classes for the wrapper: layout and spacing. */
  wrapperClassName?: string;
};

/**
 * The registered FOA logo (see public/brand/README.md): the full-colour master,
 * and in dark mode its all-white version, which FOA approved for dark
 * backgrounds (#17). Decorative (`alt=""`): name the organisation in nearby
 * text, such as a link label or a heading.
 */
export function Logo({ className, wrapperClassName }: LogoProps) {
  return (
    <span className={cn("inline-block", wrapperClassName)}>
      {/* oxlint-disable-next-line nextjs/no-img-element -- SVG master, nothing to optimise */}
      <img
        src={SITE.logo.src}
        alt=""
        width={SITE.logo.width}
        height={SITE.logo.height}
        className={cn("block dark:hidden", className)}
      />
      {/* Lazy, so light mode never downloads it while it is hidden; React
          also skips the image preload it adds for eager images. */}
      {/* oxlint-disable-next-line nextjs/no-img-element -- SVG, nothing to optimise */}
      <img
        src={SITE.logo.whiteSrc}
        alt=""
        width={SITE.logo.width}
        height={SITE.logo.height}
        loading="lazy"
        className={cn("hidden dark:block", className)}
      />
    </span>
  );
}
