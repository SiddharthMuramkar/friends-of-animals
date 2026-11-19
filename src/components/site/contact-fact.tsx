import { contactHref, type ContactKind } from "@/lib/contact";
import type { OrgFact } from "@/lib/site";
import { cn } from "@/lib/utils";

import { Placeholder } from "./placeholder";

/**
 * A tappable contact link in running text or a detail list. The vertical
 * padding lifts the tap target to at least 24px without moving the line;
 * long addresses may wrap anywhere so they never overflow a phone screen.
 */
export const CONTACT_LINK =
  "py-1 text-link underline decoration-1 underline-offset-2 [overflow-wrap:anywhere] hover:text-link-hover";

/**
 * An organisation email or phone number as a mailto:/tel: link once FOA has
 * confirmed it; until then, the visible "To be confirmed" placeholder.
 */
export function ContactFact({
  kind,
  fact,
  className,
}: {
  kind: ContactKind;
  fact: OrgFact;
  className?: string;
}) {
  return (
    <Placeholder fact={fact}>
      {(value) => (
        <a
          href={contactHref(kind, value)}
          className={cn(CONTACT_LINK, className)}
        >
          {value}
        </a>
      )}
    </Placeholder>
  );
}
