"use client";

import { usePathname } from "next/navigation";

import { NavLink } from "@/components/nav-link";

type Link = { href: string; label: string };

// The current page gets an underline as well as the tint, so it never
// rides on colour alone.
const LINK =
  "min-h-11 rounded-full px-4 font-semibold text-ink-muted decoration-section-blue-heading decoration-3 underline-offset-6 hover:bg-surface-muted hover:text-ink aria-[current=page]:bg-section-blue aria-[current=page]:text-ink aria-[current=page]:underline";

/** The admin pages, side by side; wraps on a narrow phone. */
export function AdminNavView({
  links,
  label,
  pathname,
}: {
  links: Link[];
  label: string;
  pathname: string | null;
}) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap items-center gap-1 py-2">
        {links.map((link) => (
          <li key={link.href}>
            <NavLink
              href={link.href}
              pathname={
                link.href === "/admin" && pathname !== "/admin"
                  ? null
                  : pathname
              }
              className={LINK}
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AdminNav(props: { links: Link[]; label: string }) {
  return <AdminNavView {...props} pathname={usePathname()} />;
}
