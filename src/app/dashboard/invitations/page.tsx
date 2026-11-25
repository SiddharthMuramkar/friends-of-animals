import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SubmitButton } from "@/components/form";
import { OutcomeNotice } from "@/components/form/outcome-notice";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES, DASHBOARD_INVITATIONS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { acceptAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("competitionInvitations");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function Page(props: PageProps<"/dashboard/invitations">) {
  const t = await getTranslations("competitionInvitations");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} lead={t("lead")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Content {...props} />
      </Suspense>
    </Section>
  );
}

async function Content({ searchParams }: PageProps<"/dashboard/invitations">) {
  const actor = await currentActor();
  if (actor.kind !== "user")
    redirect(
      `${ROUTES.signIn.path}?next=${encodeURIComponent(DASHBOARD_INVITATIONS)}`
    );
  const [t, notices, query, invitations] = await Promise.all([
    getTranslations("competitionInvitations"),
    getTranslations("common.callout"),
    searchParams,
    as(actor).myCompetitionInvitations(),
  ]);
  return (
    <div className="mt-8 space-y-6">
      {query.result === "unavailable" && (
        <OutcomeNotice
          tone="danger"
          label={notices("danger")}
          message={t("unavailable")}
        />
      )}
      {invitations.length === 0 ? (
        <p className="text-ink">{t("empty")}</p>
      ) : (
        <ul role="list" className="space-y-6">
          {invitations.map((invitation) => {
            const headingId = `invitation-${invitation.id}`;
            const title = t("invitedFor", {
              participant: invitation.participantName,
              competition: invitation.competitionName,
            });
            return (
              <li
                key={invitation.id}
                className="space-y-5 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6"
              >
                <SectionHeading id={headingId} title={title} />
                {invitation.relation === "guardian" && (
                  <p className="text-ink">{t("guardian")}</p>
                )}
                <form
                  action={acceptAction.bind(null, invitation.id)}
                  aria-labelledby={headingId}
                  className="space-y-4"
                >
                  {invitation.actions.map((action) => {
                    const accepted =
                      invitation.acceptedActions.includes(action);
                    const label = t(`actions.${action}`);
                    return (
                      <div
                        key={action}
                        className="space-y-2 rounded-xl border border-border p-3"
                      >
                        <p className="font-semibold text-ink">{label}</p>
                        {accepted && (
                          <p className="text-ink">{t("accepted")}</p>
                        )}
                        <SubmitButton
                          variant={accepted ? "secondary" : "primary"}
                          name="action"
                          value={action}
                          pendingLabel={t("opening")}
                          className="min-h-12 w-full sm:w-auto"
                        >
                          {accepted
                            ? t("continue", { action: label })
                            : t("choose", { action: label })}
                          <span className="sr-only"> — {title}</span>
                        </SubmitButton>
                      </div>
                    );
                  })}
                </form>
              </li>
            );
          })}
        </ul>
      )}
      <ButtonLink href={APP_ROUTES.dashboard} variant="secondary">
        {t("back")}
      </ButtonLink>
    </div>
  );
}
