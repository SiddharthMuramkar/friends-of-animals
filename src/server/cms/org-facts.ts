// The one read of FOA's organisation facts (#111) for pages, the footer and
// JSON-LD: the tax facts from settings merged with the `site_facts` CMS
// document (see ./domain/org-facts.ts).
//
// Until the CMS core's cached loader and the settings module are merged in,
// both sources are their empty defaults, which renders every fact as
// "To be confirmed", exactly as the code facts did.

import "server-only";

import { type OrgFacts, unconfirmedOrgFacts } from "./domain/org-facts";

export type { OrgFacts };

export async function getOrgFacts(): Promise<OrgFacts> {
  return unconfirmedOrgFacts();
}
