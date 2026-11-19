"use client";

import { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";

import { SiteLink } from "@/components/site/site-link";
import { cn } from "@/lib/utils";

/**
 * Fixed-size dot that fades in while the link's route loads. Render it
 * inside a <Link>; `className` places it.
 */
export function PendingDot({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 shrink-0 rounded-full bg-current transition-opacity",
        pending ? "opacity-100 delay-100" : "opacity-0",
        className
      )}
    />
  );
}

export function isCurrent(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}

/** A nav link with aria-current and a pending indicator. */
export function NavLink({
  href,
  pathname,
  className,
  children,
  ...props
}: ComponentProps<typeof SiteLink> & {
  href: string;
  pathname: string | null;
}) {
  return (
    <SiteLink
      href={href}
      aria-current={isCurrent(href, pathname) ? "page" : undefined}
      className={cn("inline-flex items-center gap-2", className)}
      {...props}
    >
      {children}
      <PendingDot />
    </SiteLink>
  );
}
