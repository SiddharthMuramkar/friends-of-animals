// submitSafeguardingReport: the public "report a concern" form (#116).
//
//   submitSafeguardingReport({ category, description, subjectDetails?,
//     subjectAge?, reporterIsChild, anonymous, reporterName?,
//     reporterContact?, website?, humanCheck })
//     → { ok: true } | invalid_input | human_check_failed | rate_limited
//
// It works without an account and answers nothing about the report: no
// id, reference, category or words, so nobody who sees the answer (or the
// confirmation page) learns what was reported.
//
// In order: the fields are checked (nothing is spent on a form the island
// must send again), then in one transaction the human check is spent, the
// bot screen runs, one report is taken from the sender's hourly allowance
// (by a keyed hash of their IP), and the report is stored with everything
// typed encrypted (#58), with its audit row and the leads' alert event.
// Anything refused rolls the whole transaction back, so a refused try costs
// no allowance and leaves no row.
//
// The report keeps no IP, user id or user agent, and its audit row is
// written as a visitor's without the request's IP and user agent, even
// when a signed-in user sends it: a concern stays anonymous even from FOA.
//
// The bot screen (a filled hidden `website` field, or a form sent within
// 3 seconds of its challenge) answers exactly as a success does, so a bot
// can't learn what gave it away.

import { z } from "zod";

import { ipNetwork } from "../../../lib/ip-network";
import { recordAudit } from "../../audit/record";
import type { FieldCipher } from "../../crypto/field-cipher";
import type { AppDb } from "../../db/app-db";
import {
  safeguardingReport,
  type SafeguardingReportRow,
} from "../../db/schema";
import { sqlState } from "../../errors";
import { uuidv7 } from "../../ids";
import { emit } from "../../outbox/emit";
import type { UseCaseContext } from "../../use-cases";
import {
  formKeyedHash,
  publicSender,
  takeFormAllowance,
  type HumanCheckProof,
} from "../public-forms";
import { readSetting } from "../settings/read";
import { seal, sealOrNull } from "./content";
import { safeguardingReportAuditSnapshot } from "./domain/audit";
import {
  parseConcern,
  screenConcern,
  type Concern,
  type ConcernField,
} from "./domain/concern";
import { newReportReference } from "./domain/reference";

export type SubmitSafeguardingReportInput = {
  /** One of CONCERN_CATEGORIES; anything else is refused. */
  category: string;
  description: string;
  subjectDetails?: string | null;
  subjectAge?: number | null;
  reporterIsChild: boolean;
  anonymous: boolean;
  reporterName?: string | null;
  reporterContact?: string | null;
  /** The hidden field: a person leaves it empty. */
  website?: string;
  humanCheck?: HumanCheckProof;
};

export type SubmitSafeguardingReportResult =
  | { ok: true }
  | { ok: false; error: "invalid_input"; fields: ConcernField[] }
  | { ok: false; error: "human_check_failed" }
  | {
      ok: false;
      error: "rate_limited";
      retryAfter: Date;
      retryAfterSeconds: number;
    };

const proofSchema = z.object({
  token: z.string().max(200),
  nonce: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

const HOUR_MS = 60 * 60 * 1000;

/** Ends the transaction, rolling it back, with what to answer. */
class Answer extends Error {
  constructor(readonly result: SubmitSafeguardingReportResult) {
    super("answered early");
  }
}

export async function submitSafeguardingReport(
  ctx: UseCaseContext,
  input: SubmitSafeguardingReportInput
): Promise<SubmitSafeguardingReportResult> {
  const sender = await publicSender(ctx, "safeguarding-concern.submit");
  const { humanCheck, website, ...fields } = input;
  const parsed = parseConcern(fields);
  if (!parsed.ok) {
    return { ok: false, error: "invalid_input", fields: parsed.fields };
  }
  const proof = proofSchema.safeParse(humanCheck);
  if (!proof.success) return { ok: false, error: "human_check_failed" };
  const now = ctx.clock.now();

  try {
    return await ctx.db.transaction(async (tx) => {
      const check = await ctx.humanCheck.redeem(tx, proof.data, now);
      if (!check.ok) {
        throw new Answer({ ok: false, error: "human_check_failed" });
      }
      const screen = screenConcern({
        honeypot: website,
        startedAt: check.issuedAt,
        now,
      });
      if (screen === "drop") throw new Answer({ ok: true });

      const allowance = await takeFormAllowance(tx, {
        form: "safeguarding",
        rules: [
          {
            scope: "ip",
            key: ipNetwork(sender.ip),
            max: await readSetting(tx, "safeguarding.reportsPerIpPerHour"),
            windowMs: HOUR_MS,
          },
        ],
        now,
        hash: formKeyedHash(ctx),
      });
      if (!allowance.ok) {
        throw new Answer({
          ok: false,
          error: "rate_limited",
          retryAfter: allowance.retryAfter,
          retryAfterSeconds: allowance.retryAfterSeconds,
        });
      }

      const report = await storeReport(tx, ctx.cipher, parsed.concern, now);
      await recordAudit(
        tx,
        { clock: ctx.clock, actor: { kind: "visitor", meta: sender } },
        {
          action: "safeguarding.report_submitted",
          entity: { type: "safeguarding_report", id: report.id },
          before: null,
          after: safeguardingReportAuditSnapshot(report),
          actorRole: null,
        },
        { withoutRequestMeta: true }
      );
      await emit(tx, ctx.clock, {
        type: "safeguarding.report_submitted",
        aggregate: { type: "safeguarding_report", id: report.id },
        payload: { reportId: report.id },
      });
      return { ok: true } as const;
    });
  } catch (error) {
    if (error instanceof Answer) return error.result;
    throw error;
  }
}

/** References a fresh one collides with are rare; past this, give up. */
const REFERENCE_ATTEMPTS = 5;

async function storeReport(
  tx: AppDb,
  cipher: FieldCipher,
  concern: Concern,
  now: Date
): Promise<SafeguardingReportRow> {
  for (let attempt = 1; ; attempt++) {
    try {
      // A savepoint, so a taken reference leaves the transaction usable.
      return await tx.transaction(async (savepoint) => {
        const [row] = await savepoint
          .insert(safeguardingReport)
          .values({
            id: uuidv7(now),
            reference: newReportReference(now),
            category: concern.category,
            description: seal(cipher, "description", concern.description),
            subjectDetails: sealOrNull(
              cipher,
              "subjectDetails",
              concern.subjectDetails
            ),
            subjectAge: concern.subjectAge,
            reporterIsChild: concern.reporterIsChild,
            anonymous: concern.anonymous,
            reporterName: sealOrNull(
              cipher,
              "reporterName",
              concern.reporterName
            ),
            reporterContact: sealOrNull(
              cipher,
              "reporterContact",
              concern.reporterContact
            ),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return row!;
      });
    } catch (error) {
      // The id is a fresh UUIDv7, so a unique violation is the reference.
      if (sqlState(error) !== "23505" || attempt >= REFERENCE_ATTEMPTS) {
        throw error;
      }
    }
  }
}
