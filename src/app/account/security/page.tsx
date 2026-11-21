import { KeyRound, Smartphone } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { orSecondFactor } from "@/app/auth/_lib/refusal";
import { FormAlert, SubmitButton } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { Callout } from "@/components/site/callout";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { safeNext, secondFactorPath } from "@/lib/second-factor-routes";
import { as, currentActor } from "@/server/app";

import { PasskeyEnrol } from "./_components/passkey-enrol";
import { TotpEnrol } from "./_components/totp-enrol";
import { removeFactorAction } from "./_lib/actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("security.account.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = Promise<{
  next?: string | string[];
  added?: string | string[];
  removed?: string | string[];
  notFound?: string | string[];
}>;

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = await getTranslations("security.account");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      {/* The whole page renders per request (app/account/layout.tsx, for
          the CSP nonce); the session read streams in behind this
          boundary, after the heading above. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Security searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const KIND_ICON = { totp: Smartphone, passkey: KeyRound } as const;

async function Security({ searchParams }: { searchParams: SearchParams }) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, totp, passkey, tc, format, mine, params] = await Promise.all([
    getTranslations("security.account"),
    getTranslations("security.totp"),
    getTranslations("security.passkey"),
    getTranslations("common.callout"),
    getFormatter(),
    orSecondFactor(() => as(actor).mySecondFactors()),
    searchParams,
  ]);
  const next = safeNext(params.next) ?? "";
  const notice =
    typeof params.added === "string"
      ? t("added")
      : typeof params.removed === "string"
        ? t("removed")
        : undefined;

  return (
    <div className="mt-8 flex flex-col gap-10">
      {notice ? (
        <FormAlert tone="success" label={tc("success")}>
          <p>{notice}</p>
        </FormAlert>
      ) : null}
      {typeof params.notFound === "string" ? (
        <FormAlert tone="danger" label={tc("danger")}>
          <p>{t("notFound")}</p>
        </FormAlert>
      ) : null}

      {mine.staff && mine.factors.length === 0 ? (
        <Callout tone="warning">
          <p>{t("staffNeedsFactor")}</p>
        </Callout>
      ) : mine.staff && mine.verifiedAt === null ? (
        <Callout tone="warning">
          <p>{t("staffNeedsVerify")}</p>
          <ButtonLink
            href={
              secondFactorPath("second_factor_required", next || undefined) ??
              APP_ROUTES.secondFactor
            }
          >
            {t("verifyNow")}
          </ButtonLink>
        </Callout>
      ) : next && mine.verifiedAt ? (
        <ButtonLink href={next}>{t("continue")}</ButtonLink>
      ) : null}

      <section aria-labelledby="security-list">
        <SectionHeading id="security-list" title={t("listTitle")} />
        {mine.factors.length === 0 ? (
          <p className="mt-5 text-ink">{t("none")}</p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {mine.factors.map((factor) => {
              const Icon = KIND_ICON[factor.kind];
              const date = format.dateTime(factor.createdAt, "longDateTime");
              return (
                <li key={factor.id} className={CARD}>
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-ink wrap-anywhere">
                    <Icon aria-hidden="true" className="size-5 shrink-0" />
                    <span>{factor.label}</span>
                  </p>
                  <p className="mt-2 text-ink-muted">
                    {t(`kind.${factor.kind}`)}
                  </p>
                  <p className="text-ink-muted">{t("addedOn", { date })}</p>
                  <form action={removeFactorAction} className="mt-4">
                    <input type="hidden" name="factorId" value={factor.id} />
                    <SubmitButton
                      variant="secondary"
                      pendingLabel={t("removing")}
                    >
                      {/* One sentence for screen readers that starts with
                          the visible word (WCAG 2.5.3). */}
                      <span aria-hidden="true">{t("remove")}</span>
                      <span className="sr-only">
                        {t("removeLabel", { label: factor.label, date })}
                      </span>
                    </SubmitButton>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="security-totp" className={CARD}>
        <h2 id="security-totp" className="text-lead font-bold text-ink">
          {totp("title")}
        </h2>
        <p className="mt-2 mb-6 text-ink">{totp("lead")}</p>
        <TotpEnrol
          next={next}
          labels={{
            label: {
              label: totp("label.label"),
              hint: totp("label.hint"),
            },
            start: totp("start"),
            starting: totp("starting"),
            scan: totp("scan"),
            qrLabel: totp("qrLabel"),
            manual: totp("manual"),
            keyLabel: totp("keyLabel"),
            code: { label: totp("code.label"), hint: totp("code.hint") },
            confirm: totp("confirm"),
            confirming: totp("confirming"),
            cancel: totp("cancel"),
            problem: tc("danger"),
          }}
        />
      </section>

      <section aria-labelledby="security-passkey" className={CARD}>
        <h2 id="security-passkey" className="text-lead font-bold text-ink">
          {passkey("title")}
        </h2>
        <p className="mt-2 mb-6 text-ink">{passkey("lead")}</p>
        <PasskeyEnrol
          next={next}
          labels={{
            label: {
              label: passkey("label.label"),
              hint: passkey("label.hint"),
              error: passkey("label.error"),
            },
            start: passkey("start"),
            starting: passkey("starting"),
            unsupported: passkey("unsupported"),
            failed: passkey("failed"),
            problem: tc("danger"),
          }}
        />
      </section>
    </div>
  );
}
