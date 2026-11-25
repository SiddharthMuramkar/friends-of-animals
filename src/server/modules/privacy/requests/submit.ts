// Filing a privacy rights request (#115a).
//
//   submitPrivacyRequest({ type, subject, correctionDetails? })
//     → { ok: true, requestId, reference }
//
// A signed-in user files about their own data (`subject: { kind: "self" }`)
// or, as a verified guardian, about a linked child (`{ kind: "child",
// childId }`). ./domain/filing.ts decides who may file what: a teen files
// access and correction for themselves, erasure goes through their
// guardian, a child of 18 files their own. A child the user isn't linked
// to is refused as forbidden, so nothing is said about it. One open
// request of each type per person at a time.
//
// The request is due after its type's period (`privacy.requestDueDays`,
// or `privacy.erasureDueDays` for an erasure), and the requester and the
// grievance officers are told by route row.
//
// Loads under plain Node: relative imports only, no "server-only".

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../../access/can";
import { recordAudit } from "../../../audit/record";
import type { AppDb } from "../../../db/app-db";
import {
  PRIVACY_REQUEST_REFERENCE_UNIQUE,
  privacyRequest,
  type PrivacyRequestRow,
} from "../../../db/schema";
import { DomainError } from "../../../errors";
import { uuidv7 } from "../../../ids";
import { invalidInput, type InvalidInput } from "../../../input";
import { emit } from "../../../outbox";
import type { UseCaseContext } from "../../../use-cases";
import { withUniqueCode } from "../../codes/codes";
import { readSetting } from "../../settings/read";
import { CORRECTION_DETAILS_MAX, seal } from "./content";
import { privacyRequestAuditSnapshot } from "./domain/audit";
import { requestDueAt } from "./domain/due";
import { decideFiling, type FilingRefusal } from "./domain/filing";
import { requestReferenceFormat } from "./domain/reference";
import {
  PRIVACY_REQUEST_TYPES,
  type PrivacyRequestType,
} from "./domain/request-status";
import { childFacts, requesterAge } from "./people";

export type SubmitPrivacyRequestInput = {
  type: PrivacyRequestType;
  subject: { kind: "self" } | { kind: "child"; childId: string };
  /** Required for a correction: what is wrong, in the requester's words. */
  correctionDetails?: string;
};

export type SubmitPrivacyRequestResult =
  | { ok: true; requestId: string; reference: string }
  | InvalidInput
  | { ok: false; error: Exclude<FilingRefusal, "not_your_child"> }
  | { ok: false; error: "already_open"; reference: string };

const submitInput = z
  .strictObject({
    type: z.enum(PRIVACY_REQUEST_TYPES),
    subject: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("self") }),
      z.strictObject({ kind: z.literal("child"), childId: z.uuid() }),
    ]),
    correctionDetails: z
      .string()
      .trim()
      .min(1)
      .max(CORRECTION_DETAILS_MAX)
      .optional(),
  })
  .superRefine((input, context) => {
    if (
      (input.type === "correction") !==
      (input.correctionDetails !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["correctionDetails"],
        message:
          input.type === "correction"
            ? "A correction says what to correct"
            : "Only a correction has details",
      });
    }
  });

/** Serialises filings about one account or profile, until commit. */
export async function lockSubject(tx: AppDb, subjectId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(115, hashtext(${subjectId}))`
  );
}

/** The open request of `type` already filed about this person, if any. */
async function openRequestAbout(
  tx: AppDb,
  type: PrivacyRequestType,
  subject: Pick<PrivacyRequestRow, "subjectKind" | "subjectId">
): Promise<string | undefined> {
  const [row] = await tx
    .select({ reference: privacyRequest.reference })
    .from(privacyRequest)
    .where(
      and(
        eq(privacyRequest.type, type),
        eq(privacyRequest.subjectKind, subject.subjectKind),
        eq(privacyRequest.subjectId, subject.subjectId),
        inArray(privacyRequest.status, ["submitted", "in_progress"])
      )
    )
    .limit(1);
  return row?.reference;
}

export async function submitPrivacyRequest(
  ctx: UseCaseContext,
  input: SubmitPrivacyRequestInput
): Promise<SubmitPrivacyRequestResult> {
  const { role } = await authorize(ctx, "privacy_request.submit");
  if (ctx.actor.kind !== "user") {
    throw new Error("Filing a privacy request needs a signed-in user");
  }
  const userId = ctx.actor.userId;
  const parsed = submitInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { type, subject, correctionDetails } = parsed.data;
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    // Two filings about one person queue here, so neither slips past the
    // other's one-open-request check.
    await lockSubject(tx, subject.kind === "self" ? userId : subject.childId);
    const decision = decideFiling({
      type,
      requesterAgeYears:
        subject.kind === "self"
          ? await requesterAge(tx, ctx.cipher, userId, now)
          : null,
      target:
        subject.kind === "self"
          ? { kind: "self" }
          : await childTarget(tx, ctx, userId, subject.childId, now),
    });
    if (!decision.ok) {
      if (decision.reason === "not_your_child") {
        throw new DomainError(
          "forbidden",
          "That child isn't linked to this guardian"
        );
      }
      return { ok: false, error: decision.reason } as const;
    }
    const about = {
      subjectKind: decision.subjectKind,
      subjectId: subject.kind === "self" ? userId : subject.childId,
    };
    const open = await openRequestAbout(tx, type, about);
    if (open !== undefined) {
      return { ok: false, error: "already_open", reference: open } as const;
    }

    const dueDays = await readSetting(
      tx,
      type === "erasure" ? "privacy.erasureDueDays" : "privacy.requestDueDays"
    );
    const row = await withUniqueCode(
      {
        format: requestReferenceFormat(now),
        constraint: PRIVACY_REQUEST_REFERENCE_UNIQUE,
      },
      // A savepoint, so a taken reference leaves the transaction usable.
      (reference) =>
        tx.transaction(async (savepoint) => {
          const [inserted] = await savepoint
            .insert(privacyRequest)
            .values({
              id: uuidv7(now),
              reference,
              type,
              status: "submitted",
              relation: decision.relation,
              ...about,
              requestedByUserId: userId,
              correctionDetails:
                correctionDetails === undefined
                  ? null
                  : seal(ctx.cipher, "correctionDetails", correctionDetails),
              dueAt: requestDueAt(now, dueDays),
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          return inserted!;
        })
    );
    await recordAudit(tx, ctx, {
      action: "privacy_request.submitted",
      entity: { type: "privacy_request", id: row.id },
      before: null,
      after: privacyRequestAuditSnapshot(row),
      actorRole: role,
    });
    await emit(tx, ctx.clock, {
      type: "privacy_request.submitted",
      aggregate: { type: "privacy_request", id: row.id },
      payload: { requestId: row.id },
    });
    return { ok: true, requestId: row.id, reference: row.reference } as const;
  });
}

async function childTarget(
  tx: AppDb,
  ctx: Pick<UseCaseContext, "cipher">,
  userId: string,
  childId: string,
  now: Date
) {
  const facts = await childFacts(tx, ctx.cipher, userId, childId, now);
  return {
    kind: "child",
    childAgeYears: facts.ageYears,
    guardian: facts.guardian,
  } as const;
}
