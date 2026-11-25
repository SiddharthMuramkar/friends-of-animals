import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/site/button-link";
import { SubmitButton } from "@/components/form";
import { PageHeader } from "@/components/site/heading";
import { judgeInvitationPath, judgeOnboardingPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { CARD, JudgeSection, Loading, Outcome } from "../../_components/common";
import { respondJudgeAction } from "../../_lib/actions";
export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
type Props = PageProps<"/judge/invitations/[token]">;
export default function Page(props: Props) {
  return (
    <JudgeSection>
      <Suspense fallback={<Loading />}>
        <Invitation {...props} />
      </Suspense>
    </JudgeSection>
  );
}
async function Invitation({ params, searchParams }: Props) {
  const [{ token }, query, actor, t] = await Promise.all([
    params,
    searchParams,
    currentActor(),
    getTranslations("judging"),
  ]);
  const result = await as(actor).viewJudgeInvitation({ token });
  const next = encodeURIComponent(judgeInvitationPath(token));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("invitation")} tile="teal" />
      <Outcome done={query.done} />
      {!result.ok ? (
        <p>{t("outcomes.not_found")}</p>
      ) : (
        <section className={CARD}>
          <h2 className="font-bold text-xl">{result.round.name}</h2>
          {result.status !== "pending" ? (
            <>
              <p>{t(`invitationStatuses.${result.status}`)}</p>
              {result.status === "accepted" && result.emailMatches ? (
                <ButtonLink href={judgeOnboardingPath(result.round.id)}>
                  {t("onboarding")}
                </ButtonLink>
              ) : null}
            </>
          ) : result.roundClosed ? (
            <p>{t("outcomes.round_closed")}</p>
          ) : !result.signedIn ? (
            <>
              <p>{t("signInFirst")}</p>
              <ButtonLink href={`${ROUTES.signIn.path}?next=${next}`}>
                {t("signIn")}
              </ButtonLink>
              <ButtonLink
                variant="secondary"
                href={`${ROUTES.signUp.path}?next=${next}`}
              >
                {t("signUp")}
              </ButtonLink>
            </>
          ) : !result.emailMatches ? (
            <p>{t("outcomes.email_mismatch")}</p>
          ) : (
            <form
              action={respondJudgeAction}
              className="flex flex-col gap-4"
              aria-label={t("invitation")}
            >
              <p>{t("invitationLead")}</p>
              <input type="hidden" name="token" value={token} />
              <SubmitButton
                name="operation"
                value="accept"
                pendingLabel={t("working")}
              >
                {t("accept")}
              </SubmitButton>
              <SubmitButton
                name="operation"
                value="decline"
                variant="secondary"
                pendingLabel={t("working")}
              >
                {t("decline")}
              </SubmitButton>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
