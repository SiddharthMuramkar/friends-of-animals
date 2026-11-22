// The one read of FOA's organisation facts (#111) for pages and JSON-LD:
// the tax settings merged with the published `site_facts` document (see
// ./facts.ts), cached under ORG_FACTS_TAG. Publishing site facts and
// changing an org.* setting both refresh that tag. Like every published
// read, call it at request time, inside <Suspense> (WithOrgFacts does
// both): the build has no database.
//
// A failed read gives every fact unconfirmed rather than an error, so the
// page (a policy, the contact page) stays readable.

import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import type { Actor } from "../../actor";
import { as } from "../../app";
import { errorSummaryForLogs } from "../../errors";
import { ORG_FACTS_TAG } from "./domain/documents";
import { type OrgFacts, unconfirmedOrgFacts } from "./domain/org-facts";

export type { OrgFacts };

/** A cached function can't read the request; the read is public. */
const PUBLIC_READER: Actor = {
  kind: "visitor",
  meta: { ip: "", userAgent: "" },
};

async function loadOrgFacts(): Promise<OrgFacts> {
  "use cache";
  cacheTag(ORG_FACTS_TAG);
  cacheLife("hours");
  return as(PUBLIC_READER).getOrgFacts();
}

export async function getOrgFacts(): Promise<OrgFacts> {
  try {
    return await loadOrgFacts();
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      `Organisation facts: could not read them: ${errorSummaryForLogs(error)}`
    );
    return unconfirmedOrgFacts();
  }
}
