import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Callout } from "@/components/site/callout";
import { Disclosure } from "@/components/site/disclosure";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { messages } from "@/i18n/messages";
import { ADMIN_PRIVACY, APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { as, currentActor } from "@/server/app";
import {
  LEGAL_HOLD_REASON_MAX,
  LEGAL_HOLD_SUBJECT_TYPES,
} from "@/server/db/schema/privacy";
import type {
  InventoryView,
  LegalHoldPage,
  RetentionPolicyView,
} from "@/server/modules/privacy";
import { legalHoldCursor } from "@/server/modules/privacy/hold-input";

import { AdminDenied } from "../_components/admin-denied";
import { adminCall } from "../_lib/boundary";
import { PlaceHoldForm, ReleaseHoldForm } from "./_components/hold-forms";

// The data inventory, retention and legal holds (#114): whether the daily
// sweep deletes or only counts, each retention policy with the period that
// applies now, the holds in force, and every column of personal data with
// why FOA holds it. Staff admins and super admins read it; only a super
// admin places or releases a hold.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminPrivacy.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page({
  searchParams,
}: PageProps<"/admin/privacy">) {
  const t = await getTranslations("adminPrivacy");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader tile="blue" title={t("title")} lead={t("lead")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Privacy searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const LINK =
  "inline-flex min-h-6 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

async function Privacy({
  searchParams,
}: Pick<PageProps<"/admin/privacy">, "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { holds: rawCursor } = await searchParams;
  const cursor =
    typeof rawCursor === "string" && legalHoldCursor(rawCursor)
      ? rawCursor
      : undefined;
  const app = as(actor);
  const result = await adminCall(
    () => Promise.all([app.getInventory(), app.listLegalHolds(cursor)]),
    ADMIN_PRIVACY
  );
  if (!result.ok) return <AdminDenied />;
  const t = await getTranslations("adminPrivacy.status");
  const [inventory, holdPage] = result.value;
  return (
    <div className="mt-8 flex flex-col gap-12">
      <Callout
        tone={inventory.enforced ? "info" : "warning"}
        title={t(inventory.enforced ? "enforcedTitle" : "countingTitle")}
      >
        <p>{t(inventory.enforced ? "enforced" : "counting")}</p>
        {inventory.canManageRetention ? (
          <p className="mt-2">
            <SiteLink href={APP_ROUTES.adminSettings} className={LINK}>
              {t("settingsLink")}
            </SiteLink>
          </p>
        ) : null}
      </Callout>
      <Policies policies={inventory.policies} />
      <Holds
        page={holdPage}
        hasCursor={cursor !== undefined}
        canManage={inventory.canManageRetention}
      />
      <Inventory entries={inventory.entries} />
    </div>
  );
}

type PolicyMessageKey = keyof typeof messages.adminPrivacy.policies.items;
type PolicyTranslations = Awaited<
  ReturnType<typeof getTranslations<"adminPrivacy.policies.items">>
>;

function policyRule(
  t: PolicyTranslations,
  policy: RetentionPolicyView
): string {
  return t(`${policy.key as PolicyMessageKey}.rule`, {
    days: policy.kind === "timed" ? policy.days : 0,
    months: policy.kind === "calendar" ? policy.months : 0,
  });
}

async function Policies({ policies }: { policies: RetentionPolicyView[] }) {
  const [t, items] = await Promise.all([
    getTranslations("adminPrivacy.policies"),
    getTranslations("adminPrivacy.policies.items"),
  ]);
  return (
    <section aria-labelledby="privacy-policies">
      <SectionHeading
        id="privacy-policies"
        title={t("title")}
        lead={t("lead")}
      />
      <TableScroller captionId="privacy-policies-caption" className="mt-6">
        <table className="w-full text-left">
          <caption id="privacy-policies-caption" className="sr-only">
            {t("caption")}
          </caption>
          <thead className="bg-surface-muted text-sm">
            <tr>
              <th scope="col" className="px-5 py-3">
                {t("policy")}
              </th>
              <th scope="col" className="px-5 py-3">
                {t("rule")}
              </th>
              <th scope="col" className="px-5 py-3">
                {t("enforcedBy")}
              </th>
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => (
              <tr key={policy.key} className="border-t-2 border-border">
                <th scope="row" className="px-5 py-4 font-semibold text-ink">
                  {items(`${policy.key as PolicyMessageKey}.name`)}
                </th>
                <td className="px-5 py-4 text-ink">
                  <p>{policyRule(items, policy)}</p>
                  {policy.kind === "timed" && policy.hasFloor ? (
                    <p className="mt-1 text-ink-muted">{t("floor")}</p>
                  ) : null}
                </td>
                <td className="px-5 py-4 text-ink">
                  {t(policy.kind === "lifecycle" ? "lifecycle" : "daily")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
    </section>
  );
}

async function Holds({
  page: { holds, nextCursor },
  hasCursor,
  canManage,
}: {
  page: LegalHoldPage;
  hasCursor: boolean;
  canManage: boolean;
}) {
  const [t, format, words] = await Promise.all([
    getTranslations("adminPrivacy.holds"),
    getFormatter(),
    getTranslations("common.callout"),
  ]);
  const labels = {
    place: t("form.place"),
    placing: t("form.placing"),
    release: t("form.release"),
    releasing: t("form.releasing"),
    done: words("success"),
    problem: words("danger"),
  };
  return (
    <section aria-labelledby="privacy-holds">
      <SectionHeading id="privacy-holds" title={t("title")} lead={t("lead")} />
      {holds.length === 0 ? (
        <p className="mt-6 text-ink">{t("none")}</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {holds.map((hold) => {
            const date = format.dateTime(hold.placedAt, "long");
            const labelId = `hold-subject-${hold.id}`;
            return (
              <li key={hold.id} className={CARD}>
                <p
                  id={labelId}
                  className="font-semibold text-ink wrap-anywhere"
                >
                  {t("subject", { type: hold.subjectType, id: hold.subjectId })}
                </p>
                <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr] [&_dt]:font-semibold [&_dt]:text-ink">
                  <dt>{t("reason")}</dt>
                  <dd className="text-ink wrap-anywhere">{hold.reason}</dd>
                  <dt>{t("placed")}</dt>
                  <dd className="text-ink">
                    {hold.placedBy
                      ? t("placedBy", { date, name: hold.placedBy.name })
                      : t("placedOn", { date })}
                  </dd>
                </dl>
                {canManage ? (
                  <ReleaseHoldForm
                    holdId={hold.id}
                    labelId={labelId}
                    labels={labels}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {hasCursor || nextCursor ? (
        <nav aria-label={t("pages")} className="mt-6 flex flex-wrap gap-4">
          {hasCursor ? (
            <SiteLink href={`${ADMIN_PRIVACY}#privacy-holds`} className={LINK}>
              {t("firstPage")}
            </SiteLink>
          ) : null}
          {nextCursor ? (
            <SiteLink
              href={`${ADMIN_PRIVACY}?holds=${encodeURIComponent(nextCursor)}#privacy-holds`}
              className={LINK}
            >
              {t("nextPage")}
            </SiteLink>
          ) : null}
        </nav>
      ) : null}
      {canManage ? (
        <div className={cn(CARD, "mt-6")}>
          <PlaceHoldForm
            labels={{
              ...labels,
              title: t("form.title"),
              type: t("form.type"),
              chooseType: t("form.chooseType"),
              id: t("form.id"),
              idHint: t("form.idHint"),
              reason: t("reason"),
              reasonHint: t("form.reasonHint"),
            }}
            types={LEGAL_HOLD_SUBJECT_TYPES.map((value) => ({
              value,
              label: t(`form.types.${value}`),
            }))}
            maxReasonLength={LEGAL_HOLD_REASON_MAX}
          />
        </div>
      ) : null}
    </section>
  );
}

async function Inventory({ entries }: Pick<InventoryView, "entries">) {
  const [t, purposes, subjectKinds, periods] = await Promise.all([
    getTranslations("adminPrivacy.inventory"),
    getTranslations("adminPrivacy.inventory.purposes"),
    getTranslations("adminPrivacy.inventory.subjectKinds"),
    getTranslations("adminPrivacy.inventory.periods"),
  ]);
  const byTable = Map.groupBy(entries, (entry) => entry.table);
  return (
    <section aria-labelledby="privacy-inventory">
      <SectionHeading
        id="privacy-inventory"
        title={t("title")}
        lead={t("lead")}
      />
      <ul className="mt-6 flex flex-col gap-3">
        {[...byTable].map(([table, entries]) => (
          <li key={table}>
            <Disclosure
              summary={
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <code className="font-mono text-ink wrap-anywhere">
                    {table}
                  </code>
                  <span className="text-ink-muted">
                    {t("columns", { count: entries.length })}
                  </span>
                </span>
              }
            >
              <ul className="flex flex-col gap-5">
                {entries.map((entry) => (
                  <li key={entry.column}>
                    <p>
                      <code className="font-mono font-semibold text-ink wrap-anywhere">
                        {entry.column}
                      </code>
                    </p>
                    <dl className="mt-2 grid gap-x-6 gap-y-2 text-ink sm:grid-cols-[auto_1fr] [&_dt]:font-semibold">
                      <dt>{t("purpose")}</dt>
                      <dd>
                        {purposes(
                          `${table}.${entry.column}` as Parameters<
                            typeof purposes
                          >[0]
                        )}
                      </dd>
                      <dt>{t("kind")}</dt>
                      <dd>{t(`categories.${entry.category}`)}</dd>
                      <dt>{t("subject")}</dt>
                      <dd className="wrap-anywhere">
                        {t("subjectPath", {
                          kind: subjectKinds(
                            entry.subject.kind as Parameters<
                              typeof subjectKinds
                            >[0]
                          ),
                          via: entry.subject.via,
                        })}
                      </dd>
                      <dt>{t("kept")}</dt>
                      <dd>
                        {periods(
                          entry.retentionMessage.key,
                          entry.retentionMessage.values
                        )}
                      </dd>
                    </dl>
                  </li>
                ))}
              </ul>
            </Disclosure>
          </li>
        ))}
      </ul>
    </section>
  );
}
