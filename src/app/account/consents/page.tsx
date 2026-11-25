import { BellOff, BellRing, CircleHelp } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SiteLink } from "@/components/site/site-link";
import { documentVersionPath } from "@/server/modules/competitions/domain/consent-attachments";
import { SubmitButton } from "@/components/form";
import { ConsentPolicyLink } from "@/components/legal/consent-policy-link";
import {
  LegalSectionsText,
  LegalShortList,
} from "@/components/legal/legal-text";
import { Chip } from "@/components/site/chip";
import { Disclosure } from "@/components/site/disclosure";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { loadLegalVersion } from "@/server/modules/cms/cached";
import { legalKeyForConsentPurpose } from "@/server/modules/cms/domain/documents";
import type { MyConsent } from "@/server/modules/consent";

import { ChangeNotice } from "./_components/change-notice";
import {
  giveConsentAction,
  giveAuctionConsentAction,
  withdrawConsentAction,
  withdrawAuctionConsentAction,
  withdrawPublicUseConsentAction,
} from "./_lib/actions";
import { CONSENT_NOTICES } from "./_lib/notice";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("consent.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = PageProps<"/account/consents">["searchParams"];

export default async function Page({
  searchParams,
}: PageProps<"/account/consents">) {
  const t = await getTranslations("consent");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      {/* The whole page renders per request (../layout.tsx); consent
          streams in behind this boundary after the heading. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Consents searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

/** `given-<token>` and the like, from the action's redirect. */
function doneOf(done: string | string[] | undefined) {
  if (typeof done !== "string") return null;
  const kind = CONSENT_NOTICES.find((each) => done.startsWith(`${each}-`));
  return kind ? { kind, key: done } : null;
}

async function Consents({ searchParams }: { searchParams: SearchParams }) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [
    t,
    callout,
    format,
    consents,
    auctionConsents,
    publicUseConsents,
    policy,
    { done },
  ] = await Promise.all([
    getTranslations("consent"),
    getTranslations("common.callout"),
    getFormatter(),
    as(actor).myConsents(),
    as(actor).myAuctionConsents(),
    as(actor).myPublicUseConsents(),
    // The messages consent rests on the privacy policy (#111).
    loadLegalVersion(legalKeyForConsentPurpose("messages")),
    searchParams,
  ]);
  const messages = consents.find((each) => each.purpose === "messages");
  if (!messages) return null;
  const { state, history, currentDocument } = messages;
  const notice = doneOf(done);
  const refused = notice?.kind === "outdated" || notice?.kind === "failed";
  const onCurrent =
    state.status === "given" && state.documentId === currentDocument?.id;
  const date = (at: Date) => format.dateTime(at, "long");

  return (
    <div className="mt-8 flex flex-col gap-10">
      {notice ? (
        <ChangeNotice
          key={notice.key}
          tone={refused ? "danger" : "success"}
          label={refused ? callout("danger") : callout("success")}
          message={t(`notice.${notice.kind}`)}
        />
      ) : null}

      <section aria-labelledby="consent-status" className={CARD}>
        <h2 id="consent-status" className="text-lead font-bold text-ink">
          {t("statusTitle")}
        </h2>
        <div className="mt-3">
          <StatusChip state={state} t={t} />
        </div>
        {state.status === "never" ? null : (
          <p className="mt-3 text-ink">
            {state.status === "given"
              ? t("givenSince", {
                  version: state.documentVersion,
                  date: date(state.since),
                })
              : t("withdrawnSince", { date: date(state.since) })}
          </p>
        )}
        {state.status === "given" && currentDocument && !onCurrent ? (
          <p className="mt-3 text-ink">
            {t("newerVersion", { version: currentDocument.version })}
          </p>
        ) : null}
        {currentDocument ? null : (
          <p className="mt-3 text-ink">{t("noDocument")}</p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          {currentDocument && !onCurrent ? (
            <form action={giveConsentAction}>
              <input
                type="hidden"
                name="documentId"
                value={currentDocument.id}
              />
              <SubmitButton pendingLabel={t("saving")}>
                {state.status === "given"
                  ? t("giveNewVersion", { version: currentDocument.version })
                  : t("give")}
              </SubmitButton>
            </form>
          ) : null}
          {state.status === "given" ? (
            <form action={withdrawConsentAction}>
              <SubmitButton
                variant={onCurrent ? "primary" : "secondary"}
                pendingLabel={t("saving")}
              >
                {t("withdraw")}
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </section>

      {publicUseConsents.length > 0 ? (
        <section aria-labelledby="public-use-consents" className={CARD}>
          <h2 id="public-use-consents" className="text-lead font-bold text-ink">
            {t("publicUse.title")}
          </h2>
          <p className="mt-3 text-ink">{t("publicUse.lead")}</p>
          <ul className="mt-4 space-y-4">
            {publicUseConsents.map((item) => (
              <li key={`${item.competitionId}:${item.purpose}`}>
                <p className="font-semibold text-ink">
                  {item.title} · {t(`publicUse.purpose.${item.purpose}`)}
                </p>
                <p className="text-ink">{t(`publicUse.${item.state}`)}</p>
                {item.state === "given" ? (
                  <form
                    className="mt-2"
                    action={withdrawPublicUseConsentAction.bind(
                      null,
                      item.competitionId,
                      item.purpose
                    )}
                  >
                    <SubmitButton pendingLabel={t("saving")}>
                      {t(`publicUse.withdraw.${item.purpose}`)}
                    </SubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {auctionConsents.length > 0 ? (
        <section aria-labelledby="auction-consents" className={CARD}>
          <h2 id="auction-consents" className="text-lead font-bold text-ink">
            {t("auction.title")}
          </h2>
          <p className="mt-3 text-ink">{t("auction.lead")}</p>
          <ul className="mt-4 space-y-4">
            {auctionConsents.map((item) => (
              <li key={item.competitionId}>
                <p className="font-semibold text-ink">{item.title}</p>
                <p className="text-ink">{t(`auction.${item.state}`)}</p>
                {item.document && !item.onCurrent ? (
                  <div className="mt-2 space-y-2">
                    <p>{t("auction.renewal")}</p>
                    <SiteLink
                      href={documentVersionPath(
                        "auction",
                        item.document.version
                      )}
                      className="underline"
                    >
                      {t("auction.read", { version: item.document.version })}
                    </SiteLink>
                    <form
                      action={giveAuctionConsentAction.bind(
                        null,
                        item.competitionId
                      )}
                    >
                      <input
                        type="hidden"
                        name="documentId"
                        value={item.document.id}
                      />
                      <SubmitButton pendingLabel={t("saving")}>
                        {t("auction.renew")}
                      </SubmitButton>
                    </form>
                  </div>
                ) : null}
                {item.state === "given" ? (
                  <form
                    className="mt-2"
                    action={withdrawAuctionConsentAction.bind(
                      null,
                      item.competitionId
                    )}
                  >
                    <SubmitButton pendingLabel={t("saving")}>
                      {t("auction.withdraw")}
                    </SubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {currentDocument ? (
        <section aria-labelledby="consent-document">
          <SectionHeading id="consent-document" title={t("documentTitle")} />
          <LegalShortList
            points={currentDocument.body.short}
            className="mt-4 list-disc space-y-2 pl-5 text-ink"
          />
          <Disclosure
            summary={t("readFull", { version: currentDocument.version })}
            className="mt-5"
          >
            <LegalSectionsText
              sections={currentDocument.body.sections}
              level="h3"
            />
          </Disclosure>
          <ConsentPolicyLink
            purpose="messages"
            current={policy}
            className="mt-4 text-ink"
          />
        </section>
      ) : null}

      <section aria-labelledby="consent-history">
        <SectionHeading id="consent-history" title={t("historyTitle")} />
        {history.length === 0 ? (
          <p className="mt-4 text-ink-muted">{t("historyEmpty")}</p>
        ) : (
          <ol className="mt-4 flex flex-col gap-3">
            {history.map((item) => (
              <li key={item.id} className={CARD}>
                <p className="font-semibold text-ink">
                  {t(`history.${item.action}`, {
                    version: item.documentVersion,
                  })}
                </p>
                <p className="mt-1 text-ink-muted">
                  {t("historyWhen", {
                    date: format.dateTime(item.occurredAt, "longDateTime"),
                    method: t(`method.${item.method}`),
                  })}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function StatusChip({
  state,
  t,
}: {
  state: MyConsent["state"];
  t: Awaited<ReturnType<typeof getTranslations<"consent">>>;
}) {
  if (state.status === "given") {
    return (
      <Chip tone="green" icon={<BellRing aria-hidden="true" />}>
        {t("status.given")}
      </Chip>
    );
  }
  return (
    <Chip
      icon={
        state.status === "withdrawn" ? (
          <BellOff aria-hidden="true" />
        ) : (
          <CircleHelp aria-hidden="true" />
        )
      }
    >
      {t(`status.${state.status}`)}
    </Chip>
  );
}
