// Shared set-up for the competition terms' Seam 1 tests: competitions in
// any status and participation, the people who act on them, and the rows
// to assert on. Test code only; nothing in the app imports it.

import { count, eq } from "drizzle-orm";

import type { Scope } from "@/server/access";
import type { Actor } from "@/server/actor";
import {
  auditLog,
  competition,
  competitionAwardScheme,
  competitionConsentDocument,
  competitionFee,
} from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import type { Harness } from "@/test/harness";

import type { Participation } from "../domain/vocabulary";

let competitions = 0;

/**
 * A competition straight in the table, in any status (the use cases that
 * publish and open registration belong to #70 and #71).
 */
export async function seedCompetition(
  h: Harness,
  options: {
    participation?: Participation | null;
    status?: (typeof competition.$inferInsert)["status"];
  } = {}
): Promise<{ id: string; slug: string }> {
  competitions += 1;
  const now = h.clock.now();
  const status = options.status ?? "draft";
  const row = {
    id: uuidv7(now),
    code: `TERM${String(competitions % 100).padStart(2, "0")}`,
    slug: `terms-competition-${competitions}`,
    name: `Terms competition ${competitions}`,
    participation:
      options.participation === undefined ? "both" : options.participation,
    status,
    publishedAt: status === "draft" ? null : now,
    createdAt: now,
    updatedAt: now,
  } as const;
  await h.db.insert(competition).values(row);
  return { id: row.id, slug: row.slug };
}

/** A signed-in competition manager, global unless `scope` says otherwise. */
export async function signInManager(
  h: Harness,
  scope: Scope = { type: "global" }
): Promise<Actor> {
  const user = await h.seed.member();
  await h.seed.grant(user, { role: "competition_manager", scope });
  return h.signIn(user);
}

/** A signed-in user holding exactly `role` globally, or no role at all. */
export async function signInWith(
  h: Harness,
  role: "content_manager" | "staff_admin" | null
): Promise<Actor> {
  const user = await h.seed.member();
  if (role) await h.seed.grant(user, { role, scope: { type: "global" } });
  return h.signIn(user);
}

/** A consent document source in #64's markup, with a marker per version. */
export function documentSource(marker: string): string {
  return `## Taking part\n\nDraft competition terms, ${marker}. Not FOA's words.`;
}

/**
 * Publishes the next version of `purpose`; returns it. The privacy notice
 * is the privacy page's text, so a content manager publishes that page
 * (#111); staff admins publish the others on #64's screen.
 */
export async function publishDocument(
  h: Harness,
  purpose:
    | "competition_terms"
    | "privacy_notice"
    | "messages"
    | "participation"
    | "public_display"
    | "social_media"
    | "auction"
    | "communications",
  marker = "version"
): Promise<{ id: string; version: number }> {
  if (purpose === "privacy_notice") return publishPrivacyPage(h, marker);
  const admin = await signInWith(h, "staff_admin");
  const published = await h.as(admin).publishConsentDocument({
    purpose,
    title: `Draft ${purpose}`,
    source: documentSource(marker),
  });
  if (!published.ok) throw new Error(JSON.stringify(published));
  return { id: published.id, version: published.version };
}

async function publishPrivacyPage(
  h: Harness,
  marker: string
): Promise<{ id: string; version: number }> {
  const manager = await signInWith(h, "content_manager");
  const saved = await h.as(manager).saveDraft({
    key: "legal_privacy",
    body: {
      short: [[`Draft privacy notice, ${marker}.`]],
      sections: [
        {
          id: "who-we-are",
          title: "Who we are",
          blocks: [{ p: [`Draft privacy text, ${marker}. Not FOA's words.`] }],
        },
      ],
    },
  });
  if (!saved.ok) throw new Error(JSON.stringify(saved));
  const published = await h
    .as(manager)
    .publishRevision({ revisionId: saved.revisionId });
  if (!published.ok) throw new Error(JSON.stringify(published));
  const notice = await h
    .as(h.visitor())
    .currentConsentDocument({ purpose: "privacy_notice" });
  if (!notice) throw new Error("The privacy page published no notice");
  return { id: notice.id, version: notice.version };
}

/** The terms rows and audit entries, to show a refusal wrote nothing. */
export async function termsRowCounts(h: Harness) {
  const counted = async (
    table:
      | typeof competitionFee
      | typeof competitionAwardScheme
      | typeof competitionConsentDocument
      | typeof auditLog
  ) => (await h.db.select({ n: count() }).from(table))[0]?.n ?? 0;
  return {
    fees: await counted(competitionFee),
    awards: await counted(competitionAwardScheme),
    documents: await counted(competitionConsentDocument),
    audit: await counted(auditLog),
  };
}

/** The audit entries about one competition, oldest first. */
export async function competitionAudit(h: Harness, competitionId: string) {
  return h.db
    .select({
      action: auditLog.action,
      actorRole: auditLog.actorRole,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .where(eq(auditLog.entityId, competitionId))
    .orderBy(auditLog.id);
}
