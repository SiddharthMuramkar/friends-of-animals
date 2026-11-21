import { Search } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { FormAlert, TextField } from "@/components/form";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { Grant } from "@/server/access";
import { as, currentActor } from "@/server/app";
import type { AuditEntryView, SearchAuditLogResult } from "@/server/audit";

import { AdminDenied } from "../_components/admin-denied";
import { grantLabel } from "../_lib/grant-label";
import { isRefusal } from "../_lib/refusal";
import { describeChange } from "./_lib/change";
import {
  auditHref,
  fieldsAtFault,
  readAuditFilters,
  searchInput,
  type AuditField,
  type AuditFilters,
} from "./_lib/filters";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAudit.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = PageProps<"/admin/audit">["searchParams"];

export default async function Page({
  searchParams,
}: PageProps<"/admin/audit">) {
  const [t, admin] = await Promise.all([
    getTranslations("adminAudit"),
    getTranslations("admin"),
  ]);
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      {/* The actor is read per request, so it streams in behind this
          boundary while the heading above is prerendered. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{admin("loading")}</p>}
      >
        <Audit searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const LINK =
  "inline-flex min-h-6 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

/** The page of entries; undefined when the policy refuses. */
async function search(
  filters: AuditFilters
): Promise<SearchAuditLogResult | undefined> {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  try {
    return await as(actor).searchAuditLog(searchInput(filters));
  } catch (error) {
    if (isRefusal(error)) return undefined;
    throw error;
  }
}

async function Audit({ searchParams }: { searchParams: SearchParams }) {
  const filters = readAuditFilters(await searchParams);
  const result = await search(filters);
  if (!result) return <AdminDenied />;
  const [t, common] = await Promise.all([
    getTranslations("adminAudit"),
    getTranslations("common.callout"),
  ]);
  const fault = result.ok
    ? { fields: [], badPage: false }
    : fieldsAtFault(result.fields);
  const filtered = Boolean(
    filters.person || filters.entityType || filters.action
  );

  return (
    <div className="mt-8 flex flex-col gap-10">
      <AuditSearch filters={filters} faults={fault.fields} />

      {result.ok ? null : (
        <FormAlert tone="danger" label={common("danger")}>
          <p>{t(fault.badPage ? "alerts.badPage" : "alerts.invalid")}</p>
          {fault.badPage ? (
            <p className="mt-2">
              <SiteLink
                href={auditHref({
                  ...filters,
                  cursor: undefined,
                  limit: undefined,
                })}
                className={LINK}
              >
                {t("newest")}
              </SiteLink>
            </p>
          ) : null}
        </FormAlert>
      )}

      {result.ok ? (
        <section aria-labelledby="audit-entries">
          <SectionHeading id="audit-entries" title={t("results")} />
          {result.entries.length === 0 ? (
            <p className="mt-4 text-ink">
              {t(filtered || filters.cursor ? "none" : "noneYet")}
            </p>
          ) : (
            <ol className="mt-4 flex flex-col gap-4">
              {result.entries.map((entry) => (
                <Entry key={entry.id} entry={entry} />
              ))}
            </ol>
          )}
          <Pages filters={filters} nextCursor={result.nextCursor} />
        </section>
      ) : null}
    </div>
  );
}

async function AuditSearch({
  filters,
  faults,
}: {
  filters: AuditFilters;
  faults: AuditField[];
}) {
  const t = await getTranslations("adminAudit");
  const error = (field: AuditField) =>
    faults.includes(field) ? t(`errors.${field}`) : undefined;
  const filtered = Boolean(
    filters.person || filters.entityType || filters.action
  );
  return (
    // Block: before Safari 17 <search> is an unknown, inline element.
    <search aria-labelledby="audit-search" className={cn("block", CARD)}>
      <h2 id="audit-search" className="text-lead font-bold text-ink">
        {t("filters.title")}
      </h2>
      {/* A plain GET form: a new search starts from the newest entries. */}
      <form action={APP_ROUTES.adminAudit} className="mt-4 flex flex-col gap-4">
        <TextField
          id="audit-person"
          name="person"
          autoComplete="off"
          spellCheck={false}
          maxLength={36}
          defaultValue={filters.person}
          label={t("filters.person")}
          hint={t("filters.personHint")}
          error={error("person")}
          className="[&_input]:font-mono"
        />
        <TextField
          id="audit-entity-type"
          name="entityType"
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          defaultValue={filters.entityType}
          label={t("filters.entityType")}
          hint={t("filters.entityTypeHint")}
          error={error("entityType")}
        />
        <TextField
          id="audit-action"
          name="action"
          autoComplete="off"
          spellCheck={false}
          maxLength={100}
          defaultValue={filters.action}
          label={t("filters.action")}
          hint={t("filters.actionHint")}
          error={error("action")}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonStyles()}>
            <Search aria-hidden="true" />
            {t("filters.submit")}
          </button>
          {filtered ? (
            <ButtonLink href={APP_ROUTES.adminAudit} variant="quiet">
              {t("filters.clear")}
            </ButtonLink>
          ) : null}
        </div>
      </form>
    </search>
  );
}

async function Entry({ entry }: { entry: AuditEntryView }) {
  const [t, admin, format] = await Promise.all([
    getTranslations("adminAudit.entry"),
    getTranslations("admin"),
    getFormatter(),
  ]);
  const { actor, entity } = entry;
  const change = describeChange(entry.before, entry.after);

  let who: string;
  if (actor.kind === "system") {
    who = t("system", { process: actor.process ?? "other" });
  } else if (actor.kind === "visitor") {
    who = t("visitor");
  } else {
    const name = actor.name ?? t("deletedAccount");
    who = actor.role
      ? t("actorAs", { name, role: admin(`roles.${actor.role}`) })
      : name;
  }

  const grants = (list: Grant[]) =>
    list.length === 0 ? (
      <p>{t("noRoles")}</p>
    ) : (
      <ul className="list-disc ps-5">
        {list.map((grant) => {
          const label = grantLabel(admin, grant);
          return <li key={label}>{label}</li>;
        })}
      </ul>
    );
  const json = (text: string | null) =>
    text === null ? (
      <p>{t("nothing")}</p>
    ) : (
      // Wraps rather than scrolling: a long value never widens the page.
      <pre className="font-mono text-sm whitespace-pre-wrap wrap-anywhere">
        {text}
      </pre>
    );

  return (
    <li className={CARD}>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <code className="font-mono font-semibold text-ink">{entry.action}</code>
        <time
          dateTime={entry.occurredAt.toISOString()}
          className="text-ink-muted"
        >
          {format.dateTime(entry.occurredAt, "longDateTime")}
        </time>
      </p>
      <dl className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-[auto_1fr] [&_dt]:font-semibold [&_dt]:text-ink">
        <dt>{t("who")}</dt>
        <dd className="text-ink wrap-anywhere">
          <p>{who}</p>
          {actor.userId ? (
            <SiteLink
              href={auditHref({ person: actor.userId })}
              className={LINK}
            >
              {t("personLink")}
            </SiteLink>
          ) : null}
        </dd>
        <dt>{t("entity")}</dt>
        <dd className="text-ink wrap-anywhere">
          <p>{t("entityValue", { type: entity.type, id: entity.id })}</p>
          {entity.type === "user" && entity.id !== actor.userId ? (
            <SiteLink href={auditHref({ person: entity.id })} className={LINK}>
              {t("personLink")}
            </SiteLink>
          ) : null}
        </dd>
        {change.kind === "grants" ? (
          <>
            {change.added.length > 0 ? (
              <>
                <dt>{t("added")}</dt>
                <dd className="text-ink wrap-anywhere">
                  {grants(change.added)}
                </dd>
              </>
            ) : null}
            {change.removed.length > 0 ? (
              <>
                <dt>{t("removed")}</dt>
                <dd className="text-ink wrap-anywhere">
                  {grants(change.removed)}
                </dd>
              </>
            ) : null}
            <dt>{t("before")}</dt>
            <dd className="text-ink wrap-anywhere">{grants(change.before)}</dd>
            <dt>{t("after")}</dt>
            <dd className="text-ink wrap-anywhere">{grants(change.after)}</dd>
          </>
        ) : (
          <>
            <dt>{t("before")}</dt>
            <dd className="min-w-0 text-ink">{json(change.before)}</dd>
            <dt>{t("after")}</dt>
            <dd className="min-w-0 text-ink">{json(change.after)}</dd>
          </>
        )}
        {entry.ip ? (
          <>
            <dt>{t("ip")}</dt>
            <dd className="text-ink wrap-anywhere">{entry.ip}</dd>
          </>
        ) : null}
      </dl>
    </li>
  );
}

async function Pages({
  filters,
  nextCursor,
}: {
  filters: AuditFilters;
  nextCursor: string | null;
}) {
  if (!filters.cursor && !nextCursor) return null;
  const t = await getTranslations("adminAudit");
  return (
    <nav aria-label={t("pages")} className="mt-6 flex flex-wrap gap-3">
      {filters.cursor ? (
        <ButtonLink
          href={auditHref({ ...filters, cursor: undefined })}
          variant="secondary"
        >
          {t("newest")}
        </ButtonLink>
      ) : null}
      {nextCursor ? (
        <ButtonLink
          href={auditHref({ ...filters, cursor: nextCursor })}
          variant="secondary"
        >
          {t("older")}
        </ButtonLink>
      ) : null}
    </nav>
  );
}
