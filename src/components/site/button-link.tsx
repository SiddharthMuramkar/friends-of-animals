import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { PendingDot } from "@/components/nav-link";
import { SiteLink } from "@/components/site/site-link";
import { cn } from "@/lib/utils";

/**
 * Pill buttons (buttons are rounded-full). Primary is the logo blue; one
 * primary action per screen. Sizes keep targets ≥ 44 px. Long labels wrap,
 * centred, rather than widen the page on phones.
 */
export const buttonStyles = cva(
  "inline-flex max-w-full items-center justify-center gap-2 rounded-full text-center font-semibold text-balance wrap-anywhere transition-[background-color,box-shadow,translate,scale,color] duration-200 ease-out select-none active:scale-[0.98] [&_svg]:size-5 [&_svg]:shrink-0 motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-fg shadow-warm hover:bg-primary-hover",
        secondary:
          "border-2 border-border-strong bg-surface text-ink hover:border-ink hover:shadow-warm",
        quiet:
          "text-link underline decoration-2 underline-offset-4 hover:bg-surface-muted hover:text-link-hover",
      },
      size: {
        // The vertical padding only shows once a label wraps.
        md: "min-h-11 px-5 py-1.5 text-body",
        lg: "min-h-13 px-7 py-2.5 text-lead",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

type ButtonLinkProps = ComponentProps<typeof SiteLink> &
  VariantProps<typeof buttonStyles>;

/**
 * A link that looks like a button, with a dot at its end while the next
 * page loads. For actions, use <button> + buttonStyles.
 */
export function ButtonLink({
  variant,
  size,
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <SiteLink
      className={cn(buttonStyles({ variant, size }), "relative", className)}
      {...props}
    >
      {children}
      {/* In the inline padding, so it never shifts or covers the label. */}
      <PendingDot className="absolute end-2 top-1/2 -translate-y-1/2" />
    </SiteLink>
  );
}
