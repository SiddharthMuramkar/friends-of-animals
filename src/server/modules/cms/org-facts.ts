// The one read of FOA's organisation facts (#111) for pages and JSON-LD:
// the tax facts merged with the published `site_facts` document (see
// ./domain/org-facts.ts). Like every published read, call it at request
// time, inside <Suspense> (WithOrgFacts does both).
//
// The tax facts are their empty defaults until the settings module's
// org.* settings are merged in.

import "server-only";

import { loadPublishedDocument } from "./cached";
import {
  EMPTY_TAX_FACTS,
  type OrgFacts,
  orgFactsFrom,
} from "./domain/org-facts";

export type { OrgFacts };

export async function getOrgFacts(): Promise<OrgFacts> {
  return orgFactsFrom(
    EMPTY_TAX_FACTS,
    await loadPublishedDocument("site_facts")
  );
}
