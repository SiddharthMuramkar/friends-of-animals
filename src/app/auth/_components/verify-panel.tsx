import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { ButtonLink } from "@/components/site/button-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { safeNext, secondFactorPath } from "@/lib/second-factor-routes";
import { as, currentActor } from "@/server/app";

import { orSecondFactor } from "../_lib/refusal";
import { VerifyForm } from "./verify-form";

const CARD =
  "mt-8 max-w-xl rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-8";

/**
 * The second-factor form for the signed-in user, with the factors they
 * hold. Reads the session, so it renders under <Suspense>.
 */
export async function VerifyPanel({
  next: rawNext,
}: {
  next: string | string[] | undefined;
}) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const next = safeNext(rawNext) ?? APP_ROUTES.accountSecurity;
  const [t, tc, mine] = await Promise.all([
    getTranslations("security.form"),
    getTranslations("common.callout"),
    orSecondFactor(() => as(actor).mySecondFactors()),
  ]);
  const hasTotp = mine.factors.some((factor) => factor.kind === "totp");
  const hasPasskey = mine.factors.some((factor) => factor.kind === "passkey");

  if (!hasTotp && !hasPasskey) {
    return (
      <div className={CARD}>
        <p className="text-ink">{t("noFactor")}</p>
        <ButtonLink
          href={
            secondFactorPath("enrolment_required", next) ??
            APP_ROUTES.accountSecurity
          }
          className="mt-4"
        >
          {t("addOne")}
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className={CARD}>
      <VerifyForm
        next={next}
        hasTotp={hasTotp}
        hasPasskey={hasPasskey}
        labels={{
          code: { label: t("code.label"), hint: t("code.hint") },
          verify: t("verify"),
          verifying: t("verifying"),
          usePasskey: t("usePasskey"),
          usingPasskey: t("usingPasskey"),
          or: t("or"),
          problem: tc("danger"),
        }}
      />
    </div>
  );
}
