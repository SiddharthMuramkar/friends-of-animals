"use server";

import { getTranslations } from "next-intl/server";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { RevisionProblem } from "@/server/modules/notifications";
import { placeholderFor } from "@/server/modules/notifications/preview";

import { unlessRefused } from "../../_lib/refusal";
import {
  refusedFormState,
  secondStepRedirect,
  templateFormState,
  type TemplateFormState,
} from "./form-state";

const form = z.object({
  key: z.string(),
  channel: z.enum(["email", "sms", "in_app"]),
  version: z.coerce.number().int().positive(),
  subject: z.string().default(""),
  body: z.string().default(""),
  dltTemplateId: z.string().default(""),
});

/**
 * Saves one channel of a template as the next version. The use case
 * authorizes (content managers and super admins, with this session's
 * second step, #60) and checks the wording; this maps its answer to what
 * the form shows, then refreshes the page so its preview and version line
 * follow. A refusal for want of a second step sends the user to enter it,
 * then back here to save again.
 */
export async function saveTemplateAction(
  previous: TemplateFormState,
  formData: FormData
): Promise<TemplateFormState> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const parsed = form.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ...previous, status: "stale" };
  const { key, channel, version, ...submitted } = parsed.data;

  const outcome = await unlessRefused(() =>
    as(actor).updateMessageTemplate({
      key,
      channel,
      version,
      subject: channel === "sms" ? null : submitted.subject,
      body: submitted.body,
      ...(channel === "sms" ? { dltTemplateId: submitted.dltTemplateId } : {}),
    })
  );
  if (!outcome.ok) {
    const lift = secondStepRedirect(outcome.refusal, key);
    if (lift) redirect(lift);
    const te = await getTranslations("adminTemplates.editor");
    return refusedFormState({ version }, submitted, te("forbidden"));
  }
  const result = outcome.value;
  const t = await getTranslations("adminTemplates.editor.problems");
  const describe = (problem: RevisionProblem) => {
    switch (problem.code) {
      case "unknown_variable":
        return t("unknown_variable", { name: placeholderFor(problem.name) });
      case "too_long":
        return t("too_long", { max: problem.max });
      default:
        return t(problem.code);
    }
  };
  const next = templateFormState({ version }, submitted, result, {
    problem: describe,
    tooLong: t("too_long_input"),
  });
  if (next.status === "saved") refresh();
  return next;
}
