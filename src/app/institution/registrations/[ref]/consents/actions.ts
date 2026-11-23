"use server";

import { refresh } from "next/cache";
import { createTranslator } from "next-intl";
import { z } from "zod";

import { LOCALE } from "@/i18n/formats";
import { messages } from "@/i18n/messages";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";

const registrationScope = z.object({
  institutionId: z.uuid(),
  registrationId: z.uuid(),
});
const contactInput = registrationScope.extend({ contactFor: z.uuid() });
const sendEnvelope = registrationScope.extend({
  studentId: z.uuid(),
  form: z.instanceof(FormData),
});
const destination = z.object({
  channel: z.enum(["email", "sms"]),
  address: z.string().max(320),
});
const revokeInput = registrationScope.extend({ linkId: z.uuid() });

const t = createTranslator({
  locale: LOCALE,
  messages: { coordinatorConsents: messages.coordinatorConsents },
  namespace: "coordinatorConsents.errors",
});

function failure(error: keyof typeof messages.coordinatorConsents.errors) {
  return { ok: false, error, message: t(error) } as const;
}

export async function suggestContactAction(
  institutionId: unknown,
  registrationId: unknown,
  studentId: unknown
) {
  const parsed = contactInput.safeParse({
    institutionId,
    registrationId,
    contactFor: studentId,
  });
  if (!parsed.success) return null;
  try {
    const list = await as(await currentActor()).listStudentConsents(
      parsed.data
    );
    return list.ok ? list.suggestedContact : null;
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
}

export async function sendLinkAction(
  institutionId: unknown,
  registrationId: unknown,
  studentId: unknown,
  _previous: unknown,
  form: unknown
) {
  const envelope = sendEnvelope.safeParse({
    institutionId,
    registrationId,
    studentId,
    form,
  });
  if (!envelope.success) return failure("invalid_input");
  const { form: submitted, ...scope } = envelope.data;
  const fields = destination.safeParse({
    channel: submitted.get("channel"),
    address: submitted.get("address"),
  });
  if (!fields.success) return failure("invalid_input");
  try {
    const result = await as(await currentActor()).sendConsentLink({
      ...scope,
      ...fields.data,
    });
    if (!result.ok) return failure(result.error);
    refresh();
    return { ok: true } as const;
  } catch (error) {
    if (error instanceof DomainError) return failure("forbidden");
    throw error;
  }
}

export async function revokeLinkAction(
  institutionId: unknown,
  registrationId: unknown,
  linkId: unknown
) {
  const parsed = revokeInput.safeParse({
    institutionId,
    registrationId,
    linkId,
  });
  if (!parsed.success) return failure("invalid_input");
  try {
    const result = await as(await currentActor()).revokeConsentLink(
      parsed.data
    );
    if (!result.ok) return failure(result.error);
    refresh();
    return { ok: true } as const;
  } catch (error) {
    if (error instanceof DomainError) return failure("forbidden");
    throw error;
  }
}
