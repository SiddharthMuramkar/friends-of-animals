import { CircleCheck } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { FormAlert, SelectField, SubmitButton } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { GuardianRequestView } from "@/server/modules/guardians";
import { GUARDIAN_RELATIONSHIPS } from "@/server/modules/registration/domain/student-details";

import { acceptGuardianRequestAction } from "../_lib/actions";
import { isRequestAcceptError } from "../_lib/request-accept-error";

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

/**
 * The guardian-request variant of an invitation's page (81b): a teen named
 * the reader as their parent or guardian. Signed out they're asked to sign
 * in or up with the requested address; signed in with it, they register as
 * a guardian first if they haven't, then confirm how they are related and
 * accept; signed in with another address they're told so. The teen's name
 * and what waits show only to the person asked.
 */
export async function GuardianRequest({
  token,
  request,
  error: rawError,
}: {
  token: string;
  request: GuardianRequestView;
  /** `?error=` from the address bar, checked here. */
  error: unknown;
}) {
  const [t, callout, format] = await Promise.all([
    getTranslations("guardian.request"),
    getTranslations("common.callout"),
    getFormatter(),
  ]);
  const home = { href: ROUTES.home.path, label: t("home") };
  const address = request.sentTo;
  const header = (
    <PageHeader eyebrow={t("eyebrow")} tile="teal" title={t("title")} />
  );

  if (request.status === "accepted") {
    return (
      <>
        {header}
        {request.forYou ? (
          <div className={cn("mt-8", CARD)}>
            <h2 className="flex items-center gap-2 text-h3">
              <CircleCheck aria-hidden="true" className="size-6 shrink-0" />
              <span>{t("accepted.title")}</span>
            </h2>
            <p className="mt-3 text-ink">{t("accepted.body")}</p>
            <ButtonLink
              href={APP_ROUTES.participant}
              variant="secondary"
              className="mt-6"
            >
              {t("accepted.action")}
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
  if (request.status === "expired" || request.status === "revoked") {
    const state = request.status;
    return (
      <>
        {header}
        <ExplainState className="mt-8" title={t(`${state}.title`)} back={home}>
          <p>{t(`${state}.body`)}</p>
        </ExplainState>
      </>
    );
  }

  const error = isRequestAcceptError(rawError) ? rawError : undefined;
  const { teen } = request;
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
            {teen
              ? t("askedBy", {
                  teen: teen.name,
                  relationship: t(`relationshipWords.${teen.relationship}`),
                })
              : t("asked")}
          </p>
          {teen && teen.competitions.length > 0 ? (
            <p className="mt-3 text-ink">
              {t("waiting", {
                competitions: format.list(teen.competitions, {
                  type: "conjunction",
                }),
              })}
            </p>
          ) : null}
          <p className="mt-3 text-ink wrap-anywhere">
            {t("sentTo", { address })}
          </p>
          <p className="mt-1 text-ink-muted">
            {t("expires", {
              date: format.dateTime(request.expiresAt, "longDateTime"),
            })}
          </p>

          {request.forYou === null ? (
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
          ) : request.forYou && request.guardianVerified ? (
            <form
              action={acceptGuardianRequestAction.bind(null, token)}
              className="mt-5 flex flex-col gap-5"
            >
              <SelectField
                id="relationship"
                name="relationship"
                required
                defaultValue={teen?.relationship ?? ""}
                label={t("relationship")}
                placeholder={t("relationshipPlaceholder")}
                options={GUARDIAN_RELATIONSHIPS.map((value) => ({
                  value,
                  label: t(`relationships.${value}`),
                }))}
              />
              <div>
                <SubmitButton pendingLabel={t("accepting")}>
                  {t("accept")}
                </SubmitButton>
              </div>
            </form>
          ) : null}
        </div>
        {request.forYou && !request.guardianVerified ? (
          <ExplainState
            title={t("verifyFirst.title")}
            back={{
              href: APP_ROUTES.guardianRegister,
              label: t("verifyFirst.action"),
            }}
          >
            <p>{t("verifyFirst.body")}</p>
          </ExplainState>
        ) : null}
        {request.forYou === false ? (
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
