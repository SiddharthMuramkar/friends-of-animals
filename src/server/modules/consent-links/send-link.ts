import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { authorize } from "../../access/can";
import { recordAudit } from "../../audit/record";
import { createLinkToken } from "../../crypto/link-token";
import type { AppDb } from "../../db/app-db";
import { competition, consentLink, type ConsentLink } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { invalidInput } from "../../input";
import { emit } from "../../outbox";
import type { UseCaseContext } from "../../use-cases";
import { parsePhoneNumber } from "../../../lib/phone";
import { normaliseEmailAddress } from "../../ports/email";
import { lockProfileSubject } from "../consent/repository";
import { institutionResource } from "../institutions/coordinators/policy";
import { decideRevoke, linkExpiresAt, linkStatus } from "./domain/link";
import { offeredPublicUses } from "./offered-uses";
import {
  CLOSED_LINK_SECRETS,
  consentLinksActive,
  LINK_CONTACT,
  LINK_TOKEN,
  schoolRegistration,
  schoolStudents,
} from "./repository";

const sendInput = z.object({
  registrationId: z.uuid(),
  studentId: z.uuid(),
  channel: z.enum(["email", "sms"]),
  address: z.string().max(320),
});

export type SendConsentLinkInput = z.input<typeof sendInput>;

const revokeInput = z.object({ registrationId: z.uuid(), linkId: z.uuid() });
export type RevokeConsentLinkInput = z.input<typeof revokeInput>;

async function revoke(
  tx: AppDb,
  ctx: UseCaseContext,
  link: ConsentLink,
  actorRole: Awaited<ReturnType<typeof authorize>>["role"],
  now: Date
) {
  const decision = decideRevoke(link, now);
  if (!decision.ok) return { ok: false, error: decision.reason } as const;
  await tx
    .update(consentLink)
    .set({ ...decision.patch, ...CLOSED_LINK_SECRETS, updatedAt: now })
    .where(eq(consentLink.id, link.id));
  await recordAudit(tx, ctx, {
    action: "consent_link.revoked",
    entity: { type: "consent_link", id: link.id },
    before: { status: link.status },
    after: { status: "revoked" },
    actorRole,
  });
  return { ok: true } as const;
}

export async function sendConsentLink(
  ctx: UseCaseContext,
  input: SendConsentLinkInput
) {
  const parsed = sendInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { registrationId, studentId, channel } = parsed.data;
  const initial = await schoolRegistration(ctx.db, { id: registrationId });
  if (!initial) return { ok: false, error: "not_found" } as const;
  const resource = institutionResource(initial.institutionId);
  await authorize(ctx, "consent_link.send", resource);
  if (!consentLinksActive(ctx.appEnv))
    return { ok: false, error: "unavailable" } as const;
  if (channel === "sms" && !(await ctx.settings.get("sms.enabled"))) {
    return { ok: false, error: "sms_disabled" } as const;
  }
  const email = normaliseEmailAddress(parsed.data.address);
  const phone =
    channel === "sms" ? parsePhoneNumber(parsed.data.address) : null;
  const address =
    channel === "email"
      ? z.email().safeParse(email).success
        ? email
        : null
      : phone?.ok
        ? phone.e164
        : null;
  if (!address)
    return { ok: false, error: "invalid_input", fields: ["address"] } as const;

  return ctx.db.transaction(async (tx) => {
    // Competition and profile locks follow the order used by #82. The
    // profile lock also serialises replacing pending links for this child.
    await tx
      .select({ id: competition.id })
      .from(competition)
      .where(eq(competition.id, initial.competition.id))
      .for("share");
    await lockProfileSubject(tx, studentId);
    const { role } = await authorize(
      { ...ctx, db: tx },
      "consent_link.send",
      resource
    );
    const school = await schoolRegistration(tx, { id: registrationId });
    if (
      !school ||
      school.status !== "active" ||
      school.schoolStatus !== "verified"
    ) {
      return { ok: false, error: "not_found" } as const;
    }
    const [student] = await schoolStudents(tx, school, {
      profileId: studentId,
      lock: true,
    });
    if (!student) return { ok: false, error: "not_found" } as const;
    const offers = await offeredPublicUses(tx, school.competition);
    if (offers.length === 0)
      return { ok: false, error: "nothing_offered" } as const;

    const now = ctx.clock.now();
    const [pending] = await tx
      .select()
      .from(consentLink)
      .where(
        and(
          eq(consentLink.participantProfileId, studentId),
          eq(consentLink.competitionId, school.competition.id),
          eq(consentLink.status, "pending")
        )
      )
      .for("update");
    if (pending) {
      if (
        pending.studentRegistrationId === student.registrationId &&
        linkStatus(pending, now) === "verified"
      ) {
        return { ok: false, error: "already_verified" } as const;
      }
      await revoke(tx, ctx, pending, role, now);
    }

    const { token, tokenHash } = createLinkToken();
    // Fixed clocks and concurrent workers can issue links in the same
    // millisecond. The profile lock gives each replacement a later id.
    const [last] = await tx
      .select({ id: consentLink.id })
      .from(consentLink)
      .where(
        and(
          eq(consentLink.participantProfileId, studentId),
          eq(consentLink.competitionId, school.competition.id)
        )
      )
      .orderBy(desc(consentLink.id))
      .limit(1);
    const lastMs = last
      ? Number.parseInt(last.id.replaceAll("-", "").slice(0, 12), 16)
      : -1;
    const linkId = uuidv7(new Date(Math.max(now.getTime(), lastMs + 1)));
    const expiresAt = linkExpiresAt(now);
    await tx.insert(consentLink).values({
      id: linkId,
      participantProfileId: studentId,
      competitionId: school.competition.id,
      institutionRegistrationId: registrationId,
      studentRegistrationId: student.registrationId,
      channel,
      contactCiphertext: ctx.cipher.encrypt(LINK_CONTACT, address),
      contactHash: ctx.blindIndex.of(LINK_CONTACT, address),
      tokenHash,
      tokenCiphertext: ctx.cipher.encrypt(LINK_TOKEN, token),
      offeredUses: offers,
      sentByUserId: ctx.actor.kind === "user" ? ctx.actor.userId : null,
      sentAt: now,
      updatedAt: now,
      expiresAt,
    });
    await emit(tx, ctx.clock, {
      type: "consent.link_sent",
      aggregate: { type: "consent_link", id: linkId },
      payload: { linkId },
    });
    await recordAudit(tx, ctx, {
      action: "consent_link.sent",
      entity: { type: "consent_link", id: linkId },
      before: null,
      after: { channel, expiresAt, status: "pending" },
      actorRole: role,
    });
    return { ok: true, linkId, expiresAt, status: "pending" } as const;
  });
}

export async function revokeConsentLink(
  ctx: UseCaseContext,
  input: RevokeConsentLinkInput
) {
  const parsed = revokeInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { registrationId, linkId } = parsed.data;
  const school = await schoolRegistration(ctx.db, { id: registrationId });
  if (!school) return { ok: false, error: "not_found" } as const;
  const resource = institutionResource(school.institutionId);
  await authorize(ctx, "consent_link.revoke", resource);
  if (!consentLinksActive(ctx.appEnv))
    return { ok: false, error: "unavailable" } as const;
  return ctx.db.transaction(async (tx) => {
    const { role } = await authorize(
      { ...ctx, db: tx },
      "consent_link.revoke",
      resource
    );
    const [link] = await tx
      .select()
      .from(consentLink)
      .where(
        and(
          eq(consentLink.id, linkId),
          eq(consentLink.institutionRegistrationId, registrationId)
        )
      )
      .for("update");
    if (!link) return { ok: false, error: "not_found" } as const;
    return revoke(tx, ctx, link, role, ctx.clock.now());
  });
}
