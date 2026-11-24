import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { FormAlert, SubmitButton, TextField } from "@/components/form";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { env } from "@/env";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { guardianFlowsActive } from "@/server/modules/guardians/availability";

import { GuardianSetupUnavailable } from "../_components/setup-unavailable";
import {
  confirmGuardianCodeAction,
  resendGuardianCodeAction,
} from "../_lib/actions";
import {
  DECLARE_FIELDS,
  isCodeError,
  type DeclareField,
  type DeclareProblem,
} from "../_lib/form-state";
import { DeclareForm } from "./_components/declare-form";

// Registering as a guardian (#81): the declaration, then the code emailed
// to the member's own address (`?step=code`). A verified guardian has
// nothing to do here and goes to their children.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("guardian.register.meta");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const HUE = "green";

const CARD =
  "flex flex-col gap-5 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

type Props = PageProps<"/guardian/register">;

export default async function Page({ searchParams }: Props) {
  const t = await getTranslations("guardian.register");
  return (
    <Section hue={HUE} tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader eyebrow={t("eyebrow")} tile={HUE} title={t("title")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Register searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const PROBLEMS: readonly DeclareProblem[] = [
  "unavailable",
  "linked_child",
  "registered_as_minor",
  "no_verified_email",
  "rate_limited",
  "unexpected",
];

async function Register({ searchParams }: Pick<Props, "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  if (!guardianFlowsActive(env().APP_ENV)) {
    return <GuardianSetupUnavailable />;
  }
  const [t, callout, profile, query] = await Promise.all([
    getTranslations("guardian.register"),
    getTranslations("common.callout"),
    as(actor).myGuardianProfile(),
    searchParams,
  ]);
  if (profile.registered && profile.verified) redirect(APP_ROUTES.guardian);
  const lead = (
    <p className="max-w-prose text-lead text-ink-muted">{t("lead")}</p>
  );

  if (profile.registered && query.step === "code") {
    const error = isCodeError(query.error) ? query.error : undefined;
    return (
      <div className="mt-8 flex flex-col gap-6">
        {lead}
        {error ? (
          <FormAlert tone="danger" label={callout("danger")}>
            <p>{t(`codeErrors.${error}`)}</p>
          </FormAlert>
        ) : query.resent ? (
          <FormAlert tone="success" label={callout("success")}>
            <p>{t("code.resent")}</p>
          </FormAlert>
        ) : null}
        <form action={confirmGuardianCodeAction} className={CARD}>
          <h2 className="text-h3">{t("code.title")}</h2>
          {profile.codeTo ? (
            <p className="text-ink wrap-anywhere">
              {t("code.sentTo", { address: profile.codeTo })}
            </p>
          ) : null}
          <TextField
            id="code"
            name="code"
            required
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            label={t("code.label")}
            error={
              error === "code_invalid"
                ? t("codeErrors.code_invalid")
                : undefined
            }
          />
          <div>
            <SubmitButton pendingLabel={t("code.submitting")}>
              {t("code.submit")}
            </SubmitButton>
          </div>
        </form>
        <form action={resendGuardianCodeAction}>
          <SubmitButton variant="secondary" pendingLabel={t("code.resending")}>
            {t("code.resend")}
          </SubmitButton>
        </form>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-6">
      {lead}
      <DeclareForm
        initial={{
          fullName: profile.registered ? profile.fullName : "",
          phone: profile.registered ? (profile.phone ?? "") : "",
        }}
        labels={{
          fields: Object.fromEntries(
            DECLARE_FIELDS.map((field) => [field, t(`fields.${field}`)])
          ) as Record<DeclareField, string>,
          phoneHint: t("fields.phoneHint"),
          invalid: Object.fromEntries(
            DECLARE_FIELDS.map((field) => [field, t(`invalid.${field}`)])
          ) as Record<DeclareField, string>,
          problems: Object.fromEntries(
            PROBLEMS.map((problem) => [problem, t(`errors.${problem}`)])
          ) as Record<DeclareProblem, string>,
          fixFields: t("problems"),
          submit: t("submit"),
          submitting: t("submitting"),
          problem: callout("danger"),
        }}
      />
    </div>
  );
}
