import { CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { FormAlert, SubmitButton } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { as, currentActor } from "@/server/app";

import { acceptInvitationAction } from "./_lib/actions";
import { isAcceptError } from "./_lib/accept-error";

// The token in the address is the invitation's only key: the page is never
// indexed, and the token is never logged or echoed beyond its own link.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("coordinators.invitation.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/invitations/[token]">;

export default function Page({ params, searchParams }: Props) {
  return (
    <Section hue="teal" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Header />
      {/* The link and the session are read per request, behind this
          boundary, while the heading is prerendered. */}
      <Suspense fallback={<Loading />}>
        <Invitation params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Header() {
  const t = await getTranslations("coordinators.invitation");
  return <PageHeader eyebrow={t("eyebrow")} tile="teal" title={t("title")} />;
}

async function Loading() {
  const t = await getTranslations("coordinators.invitation");
  return <p className="mt-8 text-ink-muted">{t("loading")}</p>;
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

async function Invitation({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const [{ token }, query, actor, t, callout, format] = await Promise.all([
    params,
    searchParams,
    currentActor(),
    getTranslations("coordinators.invitation"),
    getTranslations("common.callout"),
    getFormatter(),
  ]);
  const result = await as(actor).viewInvitation({ token });
  const home = { href: ROUTES.home.path, label: t("home") };

  if (!result.ok) {
    return (
      <ExplainState className="mt-8" title={t("notFound.title")} back={home}>
        <p>{t("notFound.body")}</p>
      </ExplainState>
    );
  }
  const { invitation } = result;
  const institution = invitation.institutionName;
  const address = invitation.maskedIdentifier;

  if (invitation.status === "accepted") {
    return invitation.forYou ? (
      <div className={cn("mt-8", CARD)}>
        <h2 className="flex items-center gap-2 text-h3">
          <CircleCheck aria-hidden="true" className="size-6 shrink-0" />
          <span>{t("accepted.title")}</span>
        </h2>
        <p className="mt-3 text-ink">{t("accepted.body", { institution })}</p>
        <ButtonLink href={home.href} variant="secondary" className="mt-6">
          {home.label}
        </ButtonLink>
      </div>
    ) : (
      <ExplainState className="mt-8" title={t("used.title")} back={home}>
        <p>{t("used.body")}</p>
      </ExplainState>
    );
  }
  if (invitation.status === "expired" || invitation.status === "revoked") {
    const state = invitation.status;
    return (
      <ExplainState className="mt-8" title={t(`${state}.title`)} back={home}>
        <p>{t(`${state}.body`, { institution })}</p>
      </ExplainState>
    );
  }

  const error = isAcceptError(query.error) ? query.error : undefined;
  return (
    <div className="mt-8 flex flex-col gap-6">
      {error ? (
        <FormAlert tone="danger" label={callout("danger")}>
          <p>{t(`errors.${error}`)}</p>
        </FormAlert>
      ) : null}
      <div className={CARD}>
        <p className="text-lead font-semibold text-ink">
          {t("invitedTo", { institution })}
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
            action={acceptInvitationAction.bind(null, token)}
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
  );
}
