"use server";

import { refresh } from "next/cache";

import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";

export async function suggestContactAction(
  registrationId: string,
  studentId: string
) {
  try {
    const list = await as(await currentActor()).listStudentConsents({
      registrationId,
      contactFor: studentId,
    });
    return list.ok ? list.suggestedContact : null;
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
}

export async function sendLinkAction(
  registrationId: string,
  studentId: string,
  _previous: unknown,
  form: FormData
) {
  const channel = form.get("channel");
  const address = form.get("address");
  if (
    (channel !== "email" && channel !== "sms") ||
    typeof address !== "string"
  ) {
    return { ok: false, error: "invalid_input" } as const;
  }
  try {
    const result = await as(await currentActor()).sendConsentLink({
      registrationId,
      studentId,
      channel,
      address,
    });
    if (!result.ok) return { ok: false, error: result.error } as const;
    refresh();
    return { ok: true } as const;
  } catch (error) {
    if (error instanceof DomainError)
      return { ok: false, error: "forbidden" } as const;
    throw error;
  }
}

export async function revokeLinkAction(registrationId: string, linkId: string) {
  try {
    const result = await as(await currentActor()).revokeConsentLink({
      registrationId,
      linkId,
    });
    if (!result.ok) return { ok: false, error: result.error } as const;
    refresh();
    return { ok: true } as const;
  } catch (error) {
    if (error instanceof DomainError)
      return { ok: false, error: "forbidden" } as const;
    throw error;
  }
}
