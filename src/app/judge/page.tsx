import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import {
  APP_ROUTES,
  judgeOnboardingPath,
  judgeRoundPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { CARD, JudgeSection } from "./_components/common";
export const metadata = { robots: { index: false, follow: false } };
export default async function Page() {
  const t = await getTranslations("judging");
  const rounds = await Rounds();
  return (
    <JudgeSection>
      <PageHeader title={t("title")} lead={t("lead")} tile="teal" />
      {rounds}
    </JudgeSection>
  );
}
async function Rounds() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const t = await getTranslations("judging");
  const scoring = await getTranslations("judgeScoring");
  const data = await as(actor).myJudgeRounds();
  return (
    <div className="mt-8 flex flex-col gap-4">
      <ButtonLink variant="quiet" href={APP_ROUTES.dashboard}>
        {t("dashboard")}
      </ButtonLink>
      {data.rounds.length ? (
        <ul className="flex flex-col gap-4">
          {data.rounds.map(({ round, readiness }) => (
            <li key={round.id} className={CARD}>
              <h2 className="font-bold text-xl">{round.name}</h2>
              <p>
                {t(`statuses.${round.status}`)} ·{" "}
                {t(readiness.ready ? "ready" : "notReady")}
              </p>
              {readiness.ready &&
              (round.status === "open" || round.status === "locked") ? (
                <ButtonLink href={judgeRoundPath(round.id)} prefetch={false}>
                  {scoring("openAssignments", { name: round.name })}
                </ButtonLink>
              ) : null}
              <ButtonLink
                href={judgeOnboardingPath(round.id)}
                variant="secondary"
              >
                {t("onboardingFor", { name: round.name })}
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
