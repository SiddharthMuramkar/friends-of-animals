// The one read of FOA's organisation facts (#111) for pages and JSON-LD:
// the tax settings merged with the published `site_facts` document (see
// ./facts.ts), cached under ORG_FACTS_TAG. Publishing site facts and
// changing an org.* setting both refresh that tag. In Draft Mode a content
// manager sees the open site facts draft instead (loadShownOrgFacts), so
// she can check it on the contact page before it goes public. Like every
// published read, call these at request time, inside <Suspense>
// (WithOrgFacts does both): the build has no database.

import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { draftMode } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";

import { as, currentActor } from "../../app";
import { DomainError, errorSummaryForLogs } from "../../errors";
import { PUBLIC_READER } from "./cached";
import { ORG_FACTS_TAG } from "./domain/documents";
import { type OrgFacts, unconfirmedOrgFacts } from "./domain/org-facts";

export type { OrgFacts };

/**
 * The published facts, cached; throws when they can't be read, so the
 * health check can tell "unknown" from "incomplete". Pages use
 * loadOrgFacts or loadShownOrgFacts, which never throw.
 */
export async function readOrgFacts(): Promise<OrgFacts> {
  "use cache";
  cacheTag(ORG_FACTS_TAG);
  cacheLife("hours");
  return as(PUBLIC_READER).getOrgFacts();
}

/**
 * The published facts. A failed read gives every fact unconfirmed rather
 * than an error, so the page (a policy, the contact page) stays readable.
 */
export async function loadOrgFacts(): Promise<OrgFacts> {
  try {
    return await readOrgFacts();
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      `Organisation facts: could not read them: ${errorSummaryForLogs(error)}`
    );
    return unconfirmedOrgFacts();
  }
}

export type ShownOrgFacts = {
  facts: OrgFacts;
  /** Whether Draft Mode is on, so the contact page shows the preview status. */
  previewing: boolean;
  /** Whether `facts` hold the unpublished site facts draft. */
  showingDraft: boolean;
};

/** The facts with the open site facts draft, if the actor may preview it. */
async function draftOrgFacts(): Promise<OrgFacts | null> {
  const actor = await currentActor();
  try {
    return await as(actor).getOrgFactsForPreview();
  } catch (error) {
    // Not (or no longer) a content manager, or no second factor in this
    // session: they see what everyone sees.
    if (error instanceof DomainError) return null;
    throw error;
  }
}

/**
 * The facts the pages show now: the published ones, or in Draft Mode the
 * open site facts draft for someone allowed to preview it. The actor is
 * read from the session on every draft request, as for the other
 * documents (./shown.ts). Read once per request (React cache), however
 * many holes of the page show a fact.
 */
export const loadShownOrgFacts = cache(
  async function loadShownOrgFacts(): Promise<ShownOrgFacts> {
    let previewing = false;
    try {
      previewing = (await draftMode()).isEnabled;
      const draft = previewing ? await draftOrgFacts() : null;
      if (draft) return { facts: draft, previewing, showingDraft: true };
    } catch (error) {
      unstable_rethrow(error);
      console.error(
        `Organisation facts: could not read the draft: ${errorSummaryForLogs(error)}`
      );
    }
    return { facts: await loadOrgFacts(), previewing, showingDraft: false };
  }
);
