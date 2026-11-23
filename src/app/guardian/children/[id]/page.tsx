import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { SubmitButton } from "@/components/form";
import { OutcomeNotice } from "@/components/form/outcome-notice";
import { Chip } from "@/components/site/chip";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { inlineLink } from "@/components/site/link-styles";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES, guardianChildConsentsPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import type { ChildDetail } from "@/server/modules/guardians";
import { parseIsoDate } from "@/server/modules/registration/domain/calendar-date";

import { withdrawTeenInvitationAction } from "../../_lib/actions";
import { isChildOutcome, type InviteProblem } from "../../_lib/form-state";
import { InviteTeenForm } from "./_components/invite-teen-form";

// One child's page (#81), for a guardian linked to them: their details,
// from 13 to 17 their own login (invite them, see the invitation waiting,
// or that the login is linked), and where to register them for a
// competition (#81). Anyone else gets the not-found
// page, streamed inside <Suspense>, so with status 200.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("guardian.child.meta");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const HUE = "green";

const CARD =
  "flex flex-col gap-4 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

type Props = PageProps<"/guardian/children/[id]">;

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("guardian.child");
  return (
    <Section hue={HUE} tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Child params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

/** The child, or null for a child this guardian may not open. */
async function childFor(
  actor: Parameters<typeof as>[0],
  childId: string
): Promise<ChildDetail | null> {
  try {
    return (await as(actor).getChild({ childId })).child;
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
}

const INVITE_PROBLEMS: readonly InviteProblem[] = [
  "invalid_input",
  "under_13",
  "adult",
  "child_has_login",
  "invitee_is_guardian",
  "rate_limited",
  "unexpected",
];

async function Child({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, query, t, callout, format] = await Promise.all([
    params,
    searchParams,
    getTranslations("guardian.child"),
    getTranslations("common.callout"),
    getFormatter(),
  ]);
  const child = await childFor(actor, id);
  if (!child) notFound();
  const name = child.fullName;
  const born = parseIsoDate(child.dateOfBirth);
  const done = isChildOutcome(query.done) ? query.done : undefined;
  const success = done && done !== "no_pending_invitation";

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} tile={HUE} title={name} />
      <div className="mt-8 flex flex-col gap-8">
        {done ? (
          <OutcomeNotice
            key={typeof query.n === "string" ? query.n : done}
            tone={success ? "success" : "danger"}
            label={success ? callout("success") : callout("danger")}
            message={t(`outcome.${done}`)}
          />
        ) : null}
        <div className={CARD}>
          <div className="flex flex-wrap items-center gap-3">
            <Chip>{t("age", { age: child.age })}</Chip>
          </div>
          {born ? (
            <p className="text-ink">
              {t("born", {
                date: format.dateTime(
                  new Date(Date.UTC(born.year, born.month - 1, born.day)),
                  { dateStyle: "long", timeZone: "UTC" }
                ),
              })}
            </p>
          ) : null}
          <p className="text-ink">{t(`relationship.${child.relationship}`)}</p>
        </div>

        {child.kind === "managed" ? (
          <p className="text-ink">{t("managed", { name })}</p>
        ) : child.kind === "adult" ? (
          <p className="text-ink">{t("adult", { name })}</p>
        ) : child.login === "linked" ? (
          <p className="text-ink">{t("linked", { name })}</p>
        ) : (
          <section aria-labelledby="child-login" className={CARD}>
            <SectionHeading id="child-login" title={t("invite.title")} />
            {child.invitation?.status === "pending" ? (
              <>
                <p className="text-ink wrap-anywhere">
                  {t("pending.body", {
                    address: child.invitation.sentTo,
                    date: format.dateTime(
                      child.invitation.expiresAt,
                      "longDateTime"
                    ),
                  })}
                </p>
                <form
                  action={withdrawTeenInvitationAction.bind(null, child.id)}
                >
                  <SubmitButton
                    variant="secondary"
                    pendingLabel={t("pending.withdrawing")}
                  >
                    {t("pending.withdraw")}
                  </SubmitButton>
                </form>
              </>
            ) : (
              <>
                <p className="text-ink">{t("invite.lead", { name })}</p>
                {child.invitation?.status === "expired" ? (
                  <p className="text-ink-muted">{t("invite.expired")}</p>
                ) : null}
                <InviteTeenForm
                  childId={child.id}
                  labels={{
                    email: {
                      label: t("invite.email"),
                      hint: t("invite.emailHint"),
                    },
                    problems: Object.fromEntries(
                      INVITE_PROBLEMS.map((problem) => [
                        problem,
                        t(`inviteErrors.${problem}`, { name }),
                      ])
                    ) as Record<InviteProblem, string>,
                    submit: t("invite.submit"),
                    submitting: t("invite.submitting"),
                    problem: callout("danger"),
                  }}
                />
              </>
            )}
          </section>
        )}

        <div>
          <ButtonLink
            href={guardianChildConsentsPath(child.id)}
            variant="secondary"
          >
            {t("consents")}
          </ButtonLink>
        </div>

        {child.kind === "adult" ? null : (
          <section aria-labelledby="child-register" className={CARD}>
            <SectionHeading id="child-register" title={t("register.title")} />
            <p className="text-ink">{t("register.body", { name })}</p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href={ROUTES.competitions.path}>
                {t("register.find")}
              </ButtonLink>
              <ButtonLink href={APP_ROUTES.participant} variant="secondary">
                {t("register.mine")}
              </ButtonLink>
            </div>
          </section>
        )}

        <p>
          <SiteLink href={APP_ROUTES.guardian} className={inlineLink}>
            {t("back")}
          </SiteLink>
        </p>
      </div>
    </>
  );
}
