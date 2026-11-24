import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { SubmitButton } from "@/components/form";
import { OutcomeNotice } from "@/components/form/outcome-notice";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { inlineLink } from "@/components/site/link-styles";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ApplicationSummary } from "@/components/volunteers/application-summary";
import { guardianChildPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import type { ChildVolunteerApplicationResult } from "@/server/modules/volunteers";

import { guardianDecideAction, guardianWithdrawAction } from "./actions";

// A teen's volunteer application (#123), for a verified guardian linked to
// them: approve or decline it while it waits for them (their approval is
// the parental consent, and sends it to the community team), withdraw it
// while it is open, and see what was decided. Anyone else gets the
// not-found page, streamed inside <Suspense>, so with status 200.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("volunteer.guardian.meta");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const HUE = "green";

const CARD =
  "flex flex-col gap-4 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

type Props = PageProps<"/guardian/children/[id]/volunteer">;

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("volunteer.guardian");
  return (
    <Section hue={HUE} tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <ChildApplication params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const OUTCOMES = [
  "approved",
  "declined",
  "withdrawn",
  "invalid_transition",
  "not_found",
] as const;
type Outcome = (typeof OUTCOMES)[number];
const SUCCESSES: ReadonlySet<Outcome> = new Set([
  "approved",
  "declined",
  "withdrawn",
]);

async function load(
  actor: Parameters<typeof as>[0],
  childId: string
): Promise<Extract<ChildVolunteerApplicationResult, { ok: true }> | null> {
  try {
    const result = await as(actor).childVolunteerApplication({ childId });
    return result.ok ? result : null;
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
}

async function ChildApplication({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, query, t, callout] = await Promise.all([
    params,
    searchParams,
    getTranslations("volunteer.guardian"),
    getTranslations("common.callout"),
  ]);
  const loaded = await load(actor, id);
  if (!loaded) notFound();
  const { child, application } = loaded;
  const name = child.fullName;
  const done = OUTCOMES.find((outcome) => outcome === query.done);
  const open =
    application?.status === "awaiting_guardian" ||
    application?.status === "submitted";

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow", { name })}
        tile={HUE}
        title={t("title", { name })}
      />
      <div className="mt-8 flex flex-col gap-8">
        {done ? (
          <OutcomeNotice
            key={typeof query.n === "string" ? query.n : done}
            tone={SUCCESSES.has(done) ? "success" : "danger"}
            label={SUCCESSES.has(done) ? callout("success") : callout("danger")}
            message={t(`outcome.${done}`, { name })}
          />
        ) : null}
        {application ? (
          <section aria-labelledby="child-application" className={CARD}>
            <SectionHeading
              id="child-application"
              title={t("application", { name })}
            />
            <ApplicationSummary
              application={application}
              audience="guardian"
              name={name}
            />
            {application.status === "awaiting_guardian" ? (
              <form
                action={guardianDecideAction.bind(
                  null,
                  child.id,
                  application.id
                )}
                className="flex flex-col gap-3"
              >
                <p className="text-ink">{t("decide.body", { name })}</p>
                <div className="flex flex-wrap gap-3">
                  <SubmitButton
                    name="decision"
                    value="approve"
                    pendingLabel={t("decide.saving")}
                  >
                    {t("decide.approve")}
                  </SubmitButton>
                  <SubmitButton
                    name="decision"
                    value="decline"
                    variant="secondary"
                    pendingLabel={t("decide.saving")}
                  >
                    {t("decide.decline")}
                  </SubmitButton>
                </div>
              </form>
            ) : null}
            {open ? (
              <form
                action={guardianWithdrawAction.bind(
                  null,
                  child.id,
                  application.id
                )}
              >
                <SubmitButton
                  variant="secondary"
                  pendingLabel={t("withdrawing")}
                >
                  {t("withdraw")}
                </SubmitButton>
              </form>
            ) : null}
          </section>
        ) : (
          <p className="text-ink">{t("none", { name })}</p>
        )}
        <p>
          <SiteLink href={guardianChildPath(child.id)} className={inlineLink}>
            {t("back", { name })}
          </SiteLink>
        </p>
      </div>
    </>
  );
}
