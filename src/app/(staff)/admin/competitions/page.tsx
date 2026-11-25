import {
  Ban,
  Eye,
  ListChecks,
  Megaphone,
  PencilLine,
  Plus,
} from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { adminCompetitionCancelPath, APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";

import { CompetitionsDenied, StatusChip } from "./_components/admin-states";
import { announcementsHref } from "./[id]/announcements/_lib/href";
import { rubricsHref } from "./[id]/rubrics/_lib/href";
import { competitionHref } from "./_lib/href";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCompetitions.list.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  const t = await getTranslations("adminCompetitions");
  return (
    <Section hue="blue" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("list.title")}
        lead={t("list.lead")}
      />
      {/* Who is asking is read per request, so the list streams in behind
          this boundary while the heading above is prerendered. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <CompetitionList />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

async function CompetitionList() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const staff = as(actor);
  const { grants } = await staff.myAccess();
  const mayCancel = grants.some(
    (grant) => grant.role === "super_admin" && grant.scope.type === "global"
  );
  const mayManage = grants.some(
    (grant) => grant.role === "competition_manager"
  );
  if (!mayCancel && !mayManage) return <CompetitionsDenied />;
  let managed, forCancellation;
  try {
    [managed, forCancellation] = await Promise.all([
      mayManage ? staff.listCompetitionsForAdmin() : [],
      mayCancel ? staff.listCompetitionsForCancellation() : null,
    ]);
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") {
      return <CompetitionsDenied />;
    }
    throw error;
  }
  const competitions = forCancellation ?? managed;
  const managedIds = new Set(managed.map(({ id }) => id));
  const [t, format] = await Promise.all([
    getTranslations("adminCompetitions.list"),
    getFormatter(),
  ]);

  return (
    <div className="mt-8 flex flex-col gap-8">
      {mayManage ? (
        <div>
          <ButtonLink href={APP_ROUTES.adminNewCompetition}>
            <Plus aria-hidden="true" />
            {t("new")}
          </ButtonLink>
        </div>
      ) : null}
      <section aria-labelledby="competitions-list">
        <SectionHeading id="competitions-list" title={t("listTitle")} />
        {competitions.length === 0 ? (
          <p className="mt-5 text-ink-muted">{t("empty")}</p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {competitions.map((competition) => (
              <li key={competition.id} className={CARD}>
                <h3 className="text-lead font-bold text-ink wrap-anywhere">
                  {competition.name}
                </h3>
                <p className="mt-2 flex flex-wrap items-center gap-3 text-ink-muted">
                  <StatusChip status={competition.status} />
                  <span>{t("code", { code: competition.code })}</span>
                </p>
                <p className="mt-2 text-ink-muted">
                  {competition.publishedAt
                    ? t("publishedOn", {
                        date: format.dateTime(
                          competition.publishedAt,
                          "longDateTime"
                        ),
                      })
                    : t("updated", {
                        date: format.dateTime(
                          competition.updatedAt,
                          "longDateTime"
                        ),
                      })}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {managedIds.has(competition.id) ? (
                    <>
                      <ButtonLink
                        href={competitionHref(competition.id, "edit")}
                        variant="secondary"
                      >
                        <PencilLine aria-hidden="true" />
                        {/* One phrase for screen readers that starts with the
                        visible word (WCAG 2.5.3). */}
                        <span aria-hidden="true">{t("edit")}</span>
                        <span className="sr-only">
                          {t("editLabel", { name: competition.name })}
                        </span>
                      </ButtonLink>
                      <ButtonLink
                        href={competitionHref(competition.id, "preview")}
                        variant="secondary"
                      >
                        <Eye aria-hidden="true" />
                        <span aria-hidden="true">{t("preview")}</span>
                        <span className="sr-only">
                          {t("previewLabel", { name: competition.name })}
                        </span>
                      </ButtonLink>
                      <ButtonLink
                        href={rubricsHref(competition.id)}
                        variant="secondary"
                      >
                        <ListChecks aria-hidden="true" />
                        <span aria-hidden="true">{t("rubrics")}</span>
                        <span className="sr-only">
                          {t("rubricsLabel", { name: competition.name })}
                        </span>
                      </ButtonLink>
                      <ButtonLink
                        href={announcementsHref(competition.id)}
                        variant="secondary"
                      >
                        <Megaphone aria-hidden="true" />
                        <span aria-hidden="true">{t("announcements")}</span>
                        <span className="sr-only">
                          {t("announcementsLabel", { name: competition.name })}
                        </span>
                      </ButtonLink>
                    </>
                  ) : null}
                  {mayCancel &&
                  competition.status !== "cancelled" &&
                  competition.status !== "results_published" ? (
                    <ButtonLink
                      href={adminCompetitionCancelPath(competition.id)}
                      variant="secondary"
                    >
                      <Ban aria-hidden="true" />
                      <span aria-hidden="true">{t("cancel")}</span>
                      <span className="sr-only">
                        {t("cancelLabel", { name: competition.name })}
                      </span>
                    </ButtonLink>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
