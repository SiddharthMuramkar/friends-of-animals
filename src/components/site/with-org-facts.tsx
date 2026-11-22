import type { ReactNode } from "react";

import { Live } from "@/components/site/live";
import {
  type OrgFacts,
  unconfirmedOrgFacts,
} from "@/server/modules/cms/domain/org-facts";
import { loadShownOrgFacts } from "@/server/modules/cms/org-facts";

/**
 * FOA's organisation facts, read at request time (in Draft Mode, with the
 * site facts draft for a content manager). The static shell shows each
 * fact as "To be confirmed" until the confirmed one streams in.
 */
async function shownFacts(): Promise<OrgFacts> {
  return (await loadShownOrgFacts()).facts;
}

export function WithOrgFacts({
  children,
}: {
  children: (facts: OrgFacts) => ReactNode;
}) {
  return (
    <Live fallback={unconfirmedOrgFacts()} load={shownFacts}>
      {children}
    </Live>
  );
}
