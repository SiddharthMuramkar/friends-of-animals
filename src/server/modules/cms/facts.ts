// Reading FOA's organisation facts (#111).
//
//   getOrgFacts()  → anyone
//
// One read merges the two owners of the facts: the tax and registration
// facts a super admin keeps in runtime settings (#62), and the published
// `site_facts` document a content manager keeps. Anyone may read them:
// every public page shows them.
//
// Loads under plain Node: relative imports only.

import { authorize } from "../../access/can";
import { readSetting } from "../settings/read";
import { type OrgFacts, orgFactsFrom, type TaxFacts } from "./domain/org-facts";
import type { CmsContext } from "./publishing";
import { getPublishedDocument } from "./reading";

/** The tax facts as their settings hold them now; "" is not confirmed. */
async function taxFacts(ctx: CmsContext): Promise<TaxFacts> {
  const [legalName, registrationType, registrationNumber, pan] =
    await Promise.all([
      readSetting(ctx.db, "org.legalName"),
      readSetting(ctx.db, "org.registrationType"),
      readSetting(ctx.db, "org.registrationNumber"),
      readSetting(ctx.db, "org.pan"),
    ]);
  return { legalName, registrationType, registrationNumber, pan };
}

/** The organisation facts the site shows now, each a value or a placeholder. */
export async function getOrgFacts(ctx: CmsContext): Promise<OrgFacts> {
  await authorize(ctx, "cms.read_published");
  const [tax, siteFacts] = await Promise.all([
    taxFacts(ctx),
    getPublishedDocument(ctx, { key: "site_facts" }),
  ]);
  return orgFactsFrom(tax, siteFacts);
}
