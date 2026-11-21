import type { ReactNode } from "react";

import { Live } from "@/components/site/live";
import {
  type OrgFacts,
  unconfirmedOrgFacts,
} from "@/server/cms/domain/org-facts";
import { getOrgFacts } from "@/server/cms/org-facts";

/**
 * FOA's organisation facts, read at request time. The static shell shows
 * each fact as "To be confirmed" until the confirmed one streams in.
 */
export function WithOrgFacts({
  children,
}: {
  children: (facts: OrgFacts) => ReactNode;
}) {
  return (
    <Live fallback={unconfirmedOrgFacts()} load={getOrgFacts}>
      {children}
    </Live>
  );
}
