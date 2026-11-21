// submitContactMessage: the public contact form (#113).
//
//   submitContactMessage({ topic, name, email, organisation?, subject,
//                          message, website?, humanCheck })
//     → { ok: true, reference } | invalid_input | human_check_failed
//       | rate_limited
//
// In order: the fields are checked (nothing is spent on a form the island
// must send again), then in one transaction the human check is spent, the
// bot screen runs, the sender's allowances are taken and the message is
// stored on its topic's team. Anything refused rolls the whole transaction
// back, so a refused try costs no allowance and leaves no row.
//
// The bot screen (a filled hidden `website` field, or a form sent within
// 3 seconds of its challenge) answers exactly as a success does, with a
// made-up reference, so a bot can't learn what gave it away.

import { z } from "zod";

import { ipNetwork } from "@/lib/ip-network";

import { contactMessage, type ContactMessage } from "../../db/schema";
import type { AppDb } from "../../db/app-db";
import { sqlState } from "../../errors";
import { uuidv7 } from "../../ids";
import type { UseCaseContext } from "../../use-cases";
import {
  formKeyedHash,
  publicSender,
  takeFormAllowance,
  type HumanCheckProof,
} from "../public-forms";
import { teamForTopic } from "./domain/routing";
import {
  contactRateRules,
  parseContactSubmission,
  screenSubmission,
  type ContactSubmission,
  type ContactSubmissionField,
} from "./domain/submission";
import { newContactReference } from "./reference";

export type SubmitContactMessageInput = {
  /** One of the seven topics; anything else is refused. */
  topic: string;
  name: string;
  email: string;
  organisation?: string;
  subject: string;
  message: string;
  /** The hidden field: a person leaves it empty. */
  website?: string;
  humanCheck?: HumanCheckProof;
};

export type SubmitContactMessageResult =
  | { ok: true; reference: string }
  | { ok: false; error: "invalid_input"; fields: ContactSubmissionField[] }
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

/** Ends the transaction, rolling it back, with what to answer. */
class Answer extends Error {
  constructor(readonly result: SubmitContactMessageResult) {
    super("answered early");
  }
}

export async function submitContactMessage(
  ctx: UseCaseContext,
  input: SubmitContactMessageInput
): Promise<SubmitContactMessageResult> {
  const sender = publicSender(ctx.actor, "submitContactMessage");
  const parsed = parseContactSubmission(input);
  if (!parsed.ok) {
    return { ok: false, error: "invalid_input", fields: parsed.fields };
  }
  const proof = proofSchema.safeParse(input.humanCheck);
  if (!proof.success) return { ok: false, error: "human_check_failed" };
  const now = ctx.clock.now();
  const hash = formKeyedHash(ctx);
  const submission = parsed.value;

  try {
    return await ctx.db.transaction(async (tx) => {
      const check = await ctx.humanCheck.redeem(tx, proof.data, now);
      if (!check.ok)
        throw new Answer({ ok: false, error: "human_check_failed" });

      const screen = screenSubmission({
        honeypot: typeof input.website === "string" ? input.website : undefined,
        startedAt: check.issuedAt,
        now,
      });
      if (screen === "drop") {
        throw new Answer({ ok: true, reference: newContactReference(now) });
      }

      const network = ipNetwork(sender.ip);
      const allowance = await takeFormAllowance(tx, {
        form: "contact",
        rules: contactRateRules({ ip: network, email: submission.email }),
        now,
        hash,
      });
      if (!allowance.ok) {
        throw new Answer({
          ok: false,
          error: "rate_limited",
          retryAfter: allowance.retryAfter,
          retryAfterSeconds: allowance.retryAfterSeconds,
        });
      }

      const message = await storeMessage(tx, {
        submission,
        ipHash: hash.of("contact_message.ip_hash", network),
        now,
      });
      return { ok: true, reference: message.reference };
    });
  } catch (error) {
    if (error instanceof Answer) return error.result;
    throw error;
  }
}

/** References a fresh one collides with are rare; past this, give up. */
const REFERENCE_ATTEMPTS = 5;

async function storeMessage(
  tx: AppDb,
  {
    submission,
    ipHash,
    now,
  }: { submission: ContactSubmission; ipHash: string; now: Date }
): Promise<ContactMessage> {
  for (let attempt = 1; ; attempt++) {
    try {
      // A savepoint, so a taken reference leaves the transaction usable.
      return await tx.transaction(async (savepoint) => {
        const [row] = await savepoint
          .insert(contactMessage)
          .values({
            id: uuidv7(now),
            reference: newContactReference(now),
            ...submission,
            team: teamForTopic(submission.topic),
            ipHash,
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
