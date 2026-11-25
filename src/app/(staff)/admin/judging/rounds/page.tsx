import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ADMIN_JUDGING_ROUNDS, adminJudgingRoundPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import { AdminDenied } from "../../_components/admin-denied";
import { CARD } from "./_components/round-form";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page() {
  const t = await getTranslations("adminJudging");
  return (
    <Section width="prose" hue="blue" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader title={t("title")} lead={t("lead")} tile="blue" />
      <Suspense fallback={<p>{t("loading")}</p>}>
        <Rounds />
      </Suspense>
    </Section>
  );
}
async function Rounds() {
  await connection();
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  try {
    return await renderRounds(as(actor));
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden")
      return <AdminDenied />;
    throw error;
  }
}

async function renderRounds(api: ReturnType<typeof as>) {
  const t = await getTranslations("adminJudging");
  const [data, access] = await Promise.all([
    api.listJudgingRounds(),
    api.myAccess(),
  ]);
  return (
    <div className="mt-8 flex flex-col gap-4">
      {access.grants.some((g) => g.role === "competition_manager") ? (
        <ButtonLink href={`${ADMIN_JUDGING_ROUNDS}/new`}>
          {t("create")}
        </ButtonLink>
      ) : null}
      {data.ok && data.rounds.length ? (
        <ul className="flex flex-col gap-4">
          {data.rounds.map((round) => (
            <li key={round.id} className={CARD}>
              <h2 className="text-xl font-bold">{round.name}</h2>
              <p>
                {t(`levels.${round.level}`)} · {t(`statuses.${round.status}`)} ·{" "}
                {t(round.judgesPhysical ? "physical" : "digital")}
              </p>
              <ButtonLink
                href={adminJudgingRoundPath(round.id)}
                variant="secondary"
              >
                {t("roundDetails", { name: round.name })}
              </ButtonLink>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("empty")}</p>
      )}
    </div>
  );
}
