import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { JudgeSection, Loading, CARD } from "../../_components/common";
import {
  JUDGE_DASHBOARD,
  judgeEntryPath,
  judgeOnboardingPath,
  judgeRoundPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
export async function generateMetadata() {
  const t = await getTranslations("judgeScoring");
  return { title: t("assignments"), robots: { index: false, follow: false } };
}
type Props = PageProps<"/judge/rounds/[id]">;
export default function Page(props: Props) {
  return (
    <JudgeSection>
      <Suspense fallback={<Loading />}>
        <Assignments {...props} />
      </Suspense>
    </JudgeSection>
  );
}
async function Assignments({ params, searchParams }: Props) {
  const [{ id }, query, actor, t] = await Promise.all([
    params,
    searchParams,
    currentActor(),
    getTranslations("judgeScoring"),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const result = await as(actor).listMyAssignments({ roundId: id });
  if (!result.ok) {
    if (result.error === "not_onboarded") redirect(judgeOnboardingPath(id));
    notFound();
  }
  const { round, entries } = result;
  const categories = [
    ...new Set(entries.map((entry) => entry.categoryLabel)),
  ].sort();
  const statuses = ["not_started", "in_progress", "complete"] as const;
  const selectedCategory =
    categories.find((category) => category === query.category) ?? "";
  const selectedStatus =
    statuses.find((status) => status === query.progress) ?? "";
  const filtered = entries.filter(
    (entry) =>
      (!selectedCategory || selectedCategory === entry.categoryLabel) &&
      (!selectedStatus || selectedStatus === entry.progress)
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("assignments")}
        eyebrow={round.name}
        tile="teal"
        lead={t("blindLead")}
      />
      <ButtonLink variant="quiet" href={JUDGE_DASHBOARD}>
        {t("judgeDashboard")}
      </ButtonLink>
      {round.status === "locked" ? (
        <p className="font-semibold">{t("readOnly")}</p>
      ) : null}
      <search className={CARD}>
        <form
          action={judgeRoundPath(id)}
          method="get"
          className="grid gap-4 sm:grid-cols-2"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="category-filter" className="font-semibold">
              {t("category")}
            </label>
            <select
              id="category-filter"
              name="category"
              defaultValue={selectedCategory}
              className="min-h-12 rounded-xl border-2 border-border-strong bg-surface px-3 text-body"
            >
              <option value="">{t("allCategories")}</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="progress-filter" className="font-semibold">
              {t("progress")}
            </label>
            <select
              id="progress-filter"
              name="progress"
              defaultValue={selectedStatus}
              className="min-h-12 rounded-xl border-2 border-border-strong bg-surface px-3 text-body"
            >
              <option value="">{t("allStatuses")}</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {t(`status.${status}`)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className={buttonStyles({ variant: "secondary" })}
          >
            {t("filter")}
          </button>
        </form>
      </search>
      <p className="font-semibold">
        {t("shown", {
          count: filtered.length,
          complete: entries.filter((entry) => entry.progress === "complete")
            .length,
          total: entries.length,
        })}
      </p>
      {filtered.length ? (
        <ul className="list-disc space-y-4 ps-5">
          {filtered.map((entry) => (
            <li key={entry.entryCode} className={CARD}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                {entry.thumbnailUrl ? (
                  // oxlint-disable-next-line nextjs/no-img-element -- Already-resized, private signed derivative. Never proxy it through the image optimiser.
                  <img
                    src={entry.thumbnailUrl}
                    alt=""
                    width={160}
                    height={120}
                    className="aspect-4/3 w-40 max-w-full rounded-xl bg-surface-muted object-contain"
                    loading="lazy"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold">
                    <ButtonLink
                      variant="quiet"
                      href={judgeEntryPath(id, entry.entryCode)}
                      prefetch={false}
                    >
                      {entry.entryCode}
                    </ButtonLink>
                  </h2>
                  <p>{entry.categoryLabel}</p>
                  <p className="font-semibold">
                    {t(`status.${entry.progress}`)}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("noEntries")}</p>
      )}
    </div>
  );
}
