import { Mail, MessageSquare, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { SubmitButton } from "@/components/form";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { InviteForm } from "./_components/invite-form";
import { OutcomeNotice } from "./_components/outcome-notice";
import {
  removeCoordinatorAction,
  revokeInvitationAction,
} from "./_lib/actions";
import { isManageOutcome } from "./_lib/invite-state";

// Render the document on each request so its scripts carry the CSP nonce
// (#65): `instant = false` lets it build with an empty static shell.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("coordinators.manage.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = PageProps<"/institution/coordinators">["searchParams"];

export default async function Page({
  searchParams,
}: PageProps<"/institution/coordinators">) {
  await connection();
  return (
    <Section hue="teal" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Header />
      {/* The list streams in behind this boundary. */}
      <Suspense fallback={<Loading />}>
        <Coordinators searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Header() {
  const t = await getTranslations("coordinators.manage");
  return (
    <PageHeader
      eyebrow={t("eyebrow")}
      tile="teal"
      title={t("title")}
      lead={t("lead")}
    />
  );
}

async function Loading() {
  const t = await getTranslations("coordinators.manage");
  return <p className="mt-8 text-ink-muted">{t("loading")}</p>;
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const SUCCESS = new Set(["removed", "withdrawn"]);

async function Coordinators({ searchParams }: { searchParams: SearchParams }) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, callout, format, access, params] = await Promise.all([
    getTranslations("coordinators.manage"),
    getTranslations("common.callout"),
    getFormatter(),
    as(actor).myAccess(),
    searchParams,
  ]);

  // The institutions this user is the authorised person of.
  const managed = access.grants.flatMap((grant) =>
    grant.role === "institution_admin" && grant.scope.type === "institution"
      ? [grant.scope.id]
      : []
  );
  const requested =
    typeof params.institution === "string" ? params.institution : undefined;
  const institutionId =
    requested && managed.includes(requested) ? requested : managed[0];
  const list = institutionId
    ? await as(actor).listCoordinators({ institutionId })
    : undefined;
  if (list && !list.ok && list.error === "institution_not_verified") {
    // Suspended since: the authorised person keeps their role (#73), but
    // the institution's coordinators wait until FOA reinstates it.
    return (
      <ExplainState
        className="mt-8"
        title={t("notVerified.title")}
        back={{
          href: APP_ROUTES.myInstitution,
          label: t("notVerified.back"),
        }}
      >
        <p>{t("notVerified.body")}</p>
      </ExplainState>
    );
  }
  if (!institutionId || !list?.ok) {
    return (
      <ExplainState
        className="mt-8"
        title={t("noInstitution.title")}
        back={{
          href: APP_ROUTES.myInstitution,
          label: t("noInstitution.back"),
        }}
      >
        <p>{t("noInstitution.body")}</p>
      </ExplainState>
    );
  }

  const done = isManageOutcome(params.done) ? params.done : undefined;

  return (
    <div className="mt-8 flex flex-col gap-10">
      <p className="text-lead font-semibold text-ink">
        {t("for", { institution: list.institution.name })}
      </p>

      {done ? (
        <OutcomeNotice
          key={typeof params.n === "string" ? params.n : done}
          tone={SUCCESS.has(done) ? "success" : "danger"}
          label={SUCCESS.has(done) ? callout("success") : callout("danger")}
          message={t(`outcome.${done}`)}
        />
      ) : null}

      <section aria-labelledby="coordinators-list">
        <SectionHeading id="coordinators-list" title={t("listTitle")} />
        {list.coordinators.length === 0 ? (
          <p className="mt-4 text-ink-muted">{t("empty")}</p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {list.coordinators.map((coordinator) => (
              <li key={coordinator.userId} className={CARD}>
                <p className="flex items-center gap-2 font-semibold text-ink wrap-anywhere">
                  <UserRound aria-hidden="true" className="size-5 shrink-0" />
                  <span>{coordinator.name}</span>
                </p>
                <p className="mt-2 text-ink-muted">
                  {t("since", {
                    date: format.dateTime(coordinator.since, "long"),
                  })}
                </p>
                <form action={removeCoordinatorAction} className="mt-4">
                  <input
                    type="hidden"
                    name="institutionId"
                    value={list.institution.id}
                  />
                  <input
                    type="hidden"
                    name="userId"
                    value={coordinator.userId}
                  />
                  <SubmitButton
                    variant="secondary"
                    pendingLabel={t("removing")}
                  >
                    {/* One sentence for screen readers, starting with the
                        visible word (WCAG 2.5.3). */}
                    <span aria-hidden="true">{t("remove")}</span>
                    <span className="sr-only">
                      {t("removeName", { name: coordinator.name })}
                    </span>
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="coordinators-invitations">
        <SectionHeading
          id="coordinators-invitations"
          title={t("invitationsTitle")}
        />
        {list.invitations.length === 0 ? (
          <p className="mt-4 text-ink-muted">{t("invitationsEmpty")}</p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {list.invitations.map((invitation) => {
              const Icon =
                invitation.channel === "email" ? Mail : MessageSquare;
              const expires = format.dateTime(
                invitation.expiresAt,
                "longDateTime"
              );
              return (
                <li key={invitation.id} className={CARD}>
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                    <Icon aria-hidden="true" className="size-5 shrink-0" />
                    <span className="wrap-anywhere">
                      {invitation.maskedIdentifier}
                    </span>
                    <Chip
                      tone={
                        invitation.status === "pending" ? "blue" : "marigold"
                      }
                    >
                      {t(`status.${invitation.status}`)}
                    </Chip>
                  </p>
                  <p className="mt-2 text-ink-muted">
                    {t(`channel.${invitation.channel}`)}
                  </p>
                  <p className="mt-1 text-ink-muted">
                    {invitation.status === "pending"
                      ? t("pending", {
                          sent: format.dateTime(invitation.sentAt, "long"),
                          expires,
                        })
                      : t("expired", { expires })}
                  </p>
                  <form action={revokeInvitationAction} className="mt-4">
                    <input
                      type="hidden"
                      name="institutionId"
                      value={list.institution.id}
                    />
                    <input
                      type="hidden"
                      name="invitationId"
                      value={invitation.id}
                    />
                    <SubmitButton
                      variant="secondary"
                      pendingLabel={t("withdrawing")}
                    >
                      <span aria-hidden="true">{t("withdraw")}</span>
                      <span className="sr-only">
                        {t("withdrawFor", {
                          address: invitation.maskedIdentifier,
                        })}
                      </span>
                    </SubmitButton>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="coordinators-invite" className={CARD}>
        <h2 id="coordinators-invite" className="text-lead font-bold text-ink">
          {t("inviteTitle")}
        </h2>
        <p className="mt-2 mb-6 text-ink">{t("inviteLead")}</p>
        <InviteForm
          institutionId={list.institution.id}
          labels={{
            identifier: {
              label: t("identifier.label"),
              hint: t("identifier.hint"),
            },
            invite: t("invite"),
            inviting: t("inviting"),
            problem: callout("danger"),
            done: callout("success"),
          }}
        />
      </section>
    </div>
  );
}
