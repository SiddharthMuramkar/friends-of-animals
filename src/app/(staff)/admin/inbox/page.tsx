import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { inputStyles } from "@/components/form";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import {
  CONTACT_TEAMS,
  CONTACT_TOPICS,
} from "@/server/modules/contact/domain/routing";
import { CONTACT_MESSAGE_STATUSES } from "@/server/modules/contact/domain/status";

import { unlessForbidden } from "./_lib/refusal";
import { STATUS_TONE } from "./_lib/status-tone";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminInbox.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = PageProps<"/admin/inbox">["searchParams"];

export default async function Page({
  searchParams,
}: PageProps<"/admin/inbox">) {
  const t = await getTranslations("adminInbox");
  return (
    <Section hue="teal" tone="tint" width="wide" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="teal"
        title={t("title")}
        lead={t("lead")}
      />
      {/* The filters and the messages are request data: both stream in. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Inbox searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const FILTERS = ["status", "team", "topic", "assignee"] as const;
type Filters = Partial<Record<(typeof FILTERS)[number], string>>;

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";
const LINK =
  "text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

async function Inbox({ searchParams }: { searchParams: SearchParams }) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const query = await searchParams;
  const filters: Filters = {};
  for (const name of FILTERS) {
    const value = query[name];
    if (typeof value === "string" && value !== "") filters[name] = value;
  }
  const [t, tc, format, result] = await Promise.all([
    getTranslations("adminInbox"),
    getTranslations("contact.topics.items"),
    getFormatter(),
    unlessForbidden(() => as(actor).listContactInbox(filters)),
  ]);
  if (result === null) {
    return (
      <ExplainState
        title={t("denied.title")}
        back={{ href: ROUTES.home.path, label: t("denied.back") }}
        className="mt-8"
      >
        <p>{t("denied.body")}</p>
      </ExplainState>
    );
  }

  const choices = {
    status: CONTACT_MESSAGE_STATUSES.map((value) => ({
      value,
      label: t(`status.${value}`),
    })),
    team: CONTACT_TEAMS.map((value) => ({ value, label: t(`teams.${value}`) })),
    topic: CONTACT_TOPICS.map((value) => ({
      value,
      label: tc(`${value}.title`),
    })),
    assignee: [
      { value: "me", label: t("filters.me") },
      { value: "unassigned", label: t("filters.unassigned") },
    ],
  };

  return (
    <>
      <section aria-labelledby="inbox-filters" className={`mt-8 ${CARD}`}>
        <SectionHeading id="inbox-filters" title={t("filters.title")} />
        <form method="get" action={APP_ROUTES.adminInbox} className="mt-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FILTERS.map((name) => (
              <div key={name} className="flex flex-col gap-2">
                <label
                  htmlFor={`filter-${name}`}
                  className="font-semibold text-ink"
                >
                  {t(`filters.${name}`)}
                </label>
                <select
                  id={`filter-${name}`}
                  name={name}
                  defaultValue={filters[name] ?? ""}
                  className={inputStyles}
                >
                  <option value="">{t("filters.any")}</option>
                  {choices[name].map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="submit" className={buttonStyles()}>
              {t("filters.apply")}
            </button>
            <ButtonLink href={APP_ROUTES.adminInbox} variant="secondary">
              {t("filters.clear")}
            </ButtonLink>
          </div>
        </form>
      </section>

      <section aria-labelledby="inbox-list" className="mt-10">
        <SectionHeading id="inbox-list" title={t("list.title")} />
        {!result.ok ? (
          <p className="mt-4 text-ink">{t("filters.invalid")}</p>
        ) : (
          <>
            <p className="mt-2 text-ink-muted">
              {t("list.count", { count: result.items.length })}
            </p>
            {result.items.length === 0 ? (
              <p className="mt-5 text-ink">{t("list.empty")}</p>
            ) : (
              <ul className="mt-5 flex flex-col gap-4">
                {result.items.map((item) => (
                  <li key={item.id} className={CARD}>
                    <div className="flex flex-wrap items-center gap-3">
                      <Chip tone={STATUS_TONE[item.status]}>
                        {t(`status.${item.status}`)}
                      </Chip>
                      <span className="font-mono text-sm text-ink-muted">
                        {item.reference}
                      </span>
                    </div>
                    <h3 className="mt-3 text-lead font-bold text-ink wrap-anywhere">
                      <SiteLink
                        href={`${APP_ROUTES.adminInbox}/${item.id}`}
                        className={LINK}
                      >
                        {item.subject}
                      </SiteLink>
                    </h3>
                    <p className="mt-2 text-ink wrap-anywhere">
                      {t("list.from", { name: item.name })}
                    </p>
                    <p className="mt-1 text-ink-muted">
                      {tc(`${item.topic}.title`)} · {t(`teams.${item.team}`)}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {t("list.received", {
                        date: format.dateTime(item.createdAt, "longDateTime"),
                      })}{" "}
                      ·{" "}
                      {item.assignee
                        ? t("list.assignedTo", { name: item.assignee.name })
                        : t("list.unassigned")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </>
  );
}
