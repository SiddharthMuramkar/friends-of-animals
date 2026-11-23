import { CircleCheck } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { GuardianSetupUnavailable } from "@/app/guardian/_components/setup-unavailable";
import { FormAlert, SubmitButton } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { env } from "@/env";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { TeenInvitationView } from "@/server/modules/guardians";
import { guardianFlowsActive } from "@/server/modules/guardians/availability";

import { acceptTeenInvitationAction } from "../_lib/actions";
import { isTeenAcceptError } from "../_lib/teen-accept-error";

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

/**
 * The teen variant of an invitation's page (#81): a guardian invited them
 * to their own login. Signed out they're asked to sign in or up with the
 * invited address; signed in with it they accept; signed in with another
 * they're told so. The guardian's name shows only to the invited teen.
 */
export async function TeenInvitation({
  token,
  invitation,
  error: rawError,
}: {
  token: string;
  invitation: TeenInvitationView;
  /** `?error=` from the address bar, checked here. */
  error: unknown;
}) {
  const [t, callout, format] = await Promise.all([
    getTranslations("guardian.invitation"),
    getTranslations("common.callout"),
    getFormatter(),
  ]);
  const home = { href: ROUTES.home.path, label: t("home") };
  const address = invitation.sentTo;
  const header = (
    <PageHeader eyebrow={t("eyebrow")} tile="teal" title={t("title")} />
  );

  if (invitation.status === "accepted") {
    return (
      <>
        {header}
        {invitation.forYou ? (
          <div className={cn("mt-8", CARD)}>
            <h2 className="flex items-center gap-2 text-h3">
              <CircleCheck aria-hidden="true" className="size-6 shrink-0" />
              <span>{t("accepted.title")}</span>
            </h2>
            <p className="mt-3 text-ink">
              {t("accepted.body", { guardian: invitation.guardianName ?? "" })}
            </p>
            <ButtonLink
              href={APP_ROUTES.dashboard}
              variant="secondary"
              className="mt-6"
            >
              {t("dashboard")}
            </ButtonLink>
          </div>
        ) : (
          <ExplainState className="mt-8" title={t("used.title")} back={home}>
            <p>{t("used.body")}</p>
          </ExplainState>
        )}
      </>
    );
  }
  if (invitation.status === "expired" || invitation.status === "revoked") {
    const state = invitation.status;
    return (
      <>
        {header}
        <ExplainState className="mt-8" title={t(`${state}.title`)} back={home}>
          <p>{t(`${state}.body`)}</p>
        </ExplainState>
      </>
    );
  }
  if (!guardianFlowsActive(env().APP_ENV)) {
    return (
      <>
        {header}
        <GuardianSetupUnavailable back={home} />
      </>
    );
  }

  const error = isTeenAcceptError(rawError) ? rawError : undefined;
  return (
    <>
      {header}
      <div className="mt-8 flex flex-col gap-6">
        {error ? (
          <FormAlert tone="danger" label={callout("danger")}>
            <p>{t(`errors.${error}`)}</p>
          </FormAlert>
        ) : null}
        <div className={CARD}>
          <p className="text-lead font-semibold text-ink">
            {invitation.guardianName
              ? t("invitedBy", { guardian: invitation.guardianName })
              : t("invited")}
          </p>
          <p className="mt-3 text-ink wrap-anywhere">
            {t("sentTo", { address })}
          </p>
          <p className="mt-1 text-ink-muted">
            {t("expires", {
              date: format.dateTime(invitation.expiresAt, "longDateTime"),
            })}
          </p>

          {invitation.forYou === null ? (
            <>
              <p className="mt-5 text-ink wrap-anywhere">
                {t("signInLead", { address })}
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <ButtonLink href={ROUTES.signIn.path}>{t("signIn")}</ButtonLink>
                <ButtonLink href={ROUTES.signUp.path} variant="secondary">
                  {t("signUp")}
                </ButtonLink>
              </div>
            </>
          ) : invitation.forYou ? (
            <form
              action={acceptTeenInvitationAction.bind(null, token)}
              className="mt-5"
            >
              <SubmitButton pendingLabel={t("accepting")}>
                {t("accept")}
              </SubmitButton>
            </form>
          ) : null}
        </div>
        {invitation.forYou === false ? (
          <ExplainState
            title={t("mismatch.title")}
            back={{
              href: APP_ROUTES.accountSessions,
              label: t("mismatch.action"),
            }}
          >
            <p className="wrap-anywhere">{t("mismatch.body", { address })}</p>
          </ExplainState>
        ) : null}
      </div>
    </>
  );
}
