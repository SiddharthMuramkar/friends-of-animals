import { BellOff, BellRing, CircleHelp } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SubmitButton } from "@/components/form";
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
import type { MyConsent } from "@/server/modules/consent";

import { ChangeNotice } from "./_components/change-notice";
import { giveConsentAction, withdrawConsentAction } from "./_lib/actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("consent.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = Promise<{ done?: string | string[] }>;

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = await getTranslations("consent");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      {/* Consent is read per request, so it streams in behind this
          boundary while the heading above is prerendered. */}
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

const DONE = ["given", "withdrawn", "outdated"] as const;

/** `given-<token>` and the like, from the action's redirect. */
function doneOf(done: string | string[] | undefined) {
  if (typeof done !== "string") return null;
  const kind = DONE.find((each) => done.startsWith(`${each}-`));
  return kind ? { kind, key: done } : null;
}

async function Consents({ searchParams }: { searchParams: SearchParams }) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, callout, format, consents, { done }] = await Promise.all([
    getTranslations("consent"),
    getTranslations("common.callout"),
    getFormatter(),
    as(actor).myConsents(),
    searchParams,
  ]);
  const messages = consents.find((each) => each.purpose === "messages");
  if (!messages) return null;
  const { state, history, currentDocument } = messages;
  const notice = doneOf(done);
  const onCurrent =
    state.status === "given" && state.documentId === currentDocument?.id;
  const date = (at: Date) => format.dateTime(at, "long");

  return (
    <div className="mt-8 flex flex-col gap-10">
      {notice ? (
        <ChangeNotice
          key={notice.key}
          tone={notice.kind === "outdated" ? "danger" : "success"}
          label={
            notice.kind === "outdated" ? callout("danger") : callout("success")
          }
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
