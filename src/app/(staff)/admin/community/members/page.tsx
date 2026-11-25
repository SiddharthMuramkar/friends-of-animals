import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { inputStyles } from "@/components/form";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ADMIN_COMMUNITY_MEMBERS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { COMMUNITY_MEMBER_STATUSES } from "@/server/modules/community/domain/membership";
import { adminCall } from "../../_lib/boundary";
import { AdminDenied } from "../../_components/admin-denied";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("community.meta");
  return { title: t("members"), robots: { index: false, follow: false } };
}
type Props = PageProps<"/admin/community/members">;
export default async function Page({ searchParams }: Props) {
  const t = await getTranslations("community");
  return (
    <Section hue="green" tone="tint" width="wide" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={t("admin.title")}
        lead={t("admin.intro")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Members searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}
async function Members({ searchParams }: Pick<Props, "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [query, t, format] = await Promise.all([
    searchParams,
    getTranslations("community"),
    getFormatter(),
  ]);
  const status = COMMUNITY_MEMBER_STATUSES.find(
    (value) => value === query.status
  );
  const candidate = typeof query.page === "string" ? Number(query.page) : 1;
  const page =
    Number.isSafeInteger(candidate) && candidate >= 1 && candidate <= 100000
      ? candidate
      : 1;
  const link = (n: number) =>
    `${ADMIN_COMMUNITY_MEMBERS}?${new URLSearchParams({ page: String(n), ...(status ? { status } : {}) })}`;
  const loaded = await adminCall(
    () => as(actor).listMembers({ ...(status ? { status } : {}), page }),
    link(page)
  );
  if (!loaded.ok) return <AdminDenied />;
  const result = loaded.value;
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const date = (value: Date) =>
    format.dateTime(value, { dateStyle: "medium", timeZone: "Asia/Kolkata" });
  return (
    <div className="mt-8 flex flex-col gap-6">
      <form
        action={ADMIN_COMMUNITY_MEMBERS}
        method="GET"
        aria-label={t("admin.filter")}
        className="flex flex-wrap items-end gap-4 rounded-3xl border-2 border-border bg-surface p-5"
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="member-status" className="font-semibold text-ink">
            {t("admin.filter")}
          </label>
          <select
            id="member-status"
            name="status"
            className={inputStyles}
            defaultValue={status ?? ""}
          >
            <option value="">{t("status.all")}</option>
            {COMMUNITY_MEMBER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`status.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonStyles()}>
          {t("admin.apply")}
        </button>
      </form>
      <section aria-labelledby="member-list">
        <SectionHeading
          id="member-list"
          title={t("admin.count", { count: result.total })}
        />
        {result.members.length === 0 ? (
          <p className="mt-4 text-ink-muted">{t("admin.empty")}</p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {result.members.map((member) => (
              <li
                key={member.id}
                className="min-w-0 break-words rounded-3xl border-2 border-border bg-surface p-5"
              >
                <h3 className="font-bold text-ink">
                  {member.displayName ?? t("removed")}
                </h3>
                <p className="mt-1 text-ink-muted">
                  {t(`admin.kind.${member.subjectKind}`)}
                </p>
                <p className="mt-2 font-semibold text-ink">
                  {t(`status.${member.status}`)}
                </p>
                <dl className="mt-3 space-y-2 text-ink">
                  <div>
                    <dt className="font-semibold">{t("joined")}</dt>
                    <dd>
                      <time dateTime={member.joinedAt.toISOString()}>
                        {date(member.joinedAt)}
                      </time>
                    </dd>
                  </div>
                  {member.leftAt ? (
                    <div>
                      <dt className="font-semibold">{t("left")}</dt>
                      <dd>
                        <time dateTime={member.leftAt.toISOString()}>
                          {date(member.leftAt)}
                        </time>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-ink-muted">{t("admin.page", { page, pages })}</p>
      <div className="flex flex-wrap gap-3">
        {page > 1 ? (
          <ButtonLink variant="secondary" href={link(page - 1)}>
            {t("admin.previous")}
          </ButtonLink>
        ) : null}
        {page < pages ? (
          <ButtonLink variant="secondary" href={link(page + 1)}>
            {t("admin.next")}
          </ButtonLink>
        ) : null}
      </div>
    </div>
  );
}
