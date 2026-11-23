import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { NextIntlClientProvider } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { messages } from "@/i18n/messages";
import { as, currentActor } from "@/server/app";

import {
  AnswersForm,
  SendCodeForm,
  VerifyCodeForm,
} from "./_components/consent-forms";
import { ANSWER_COOKIE } from "./cookie";

// The bearer path uses the per-request nonce, even for a closed link.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("guardianConsent");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Props = PageProps<"/consent/[token]">;

export default async function Page(props: Props) {
  await connection();
  const t = await getTranslations("guardianConsent");
  return (
    <Section hue="teal" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader tile="teal" title={t("title")} />
      <Suspense
        fallback={<p className="mt-6 text-ink-muted">{t("loading")}</p>}
      >
        <ConsentLink {...props} />
      </Suspense>
    </Section>
  );
}

async function ConsentLink({ params, searchParams }: Props) {
  const [{ token }, query, actor, jar, t, format] = await Promise.all([
    params,
    searchParams,
    currentActor(),
    cookies(),
    getTranslations("guardianConsent"),
    getFormatter(),
  ]);
  const sessionToken = jar.get(ANSWER_COOKIE)?.value;
  const link = await as(actor).viewConsentLink({
    token,
    ...(sessionToken ? { sessionToken } : {}),
  });
  if (!("uses" in link)) {
    const state =
      link.status === "used" && query.done === "1" ? "done" : link.status;
    return (
      <ExplainState className="mt-8" title={t(`states.${state}.title`)}>
        <p>{t(`states.${state}.body`)}</p>
      </ExplainState>
    );
  }
  return (
    <div className="mt-8 flex flex-col gap-5 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6">
      <p className="text-lead font-semibold text-ink wrap-anywhere">
        {t("intro", {
          child: link.childFirstName,
          institution: link.institutionName,
          competition: link.competitionTitle,
        })}
      </p>
      <NextIntlClientProvider
        messages={{
          guardianConsent: messages.guardianConsent,
          common: { callout: messages.common.callout },
        }}
      >
        {link.status === "sent" ? (
          <>
            <p className="text-ink-muted wrap-anywhere">
              {t("sendHint", { contact: link.maskedContact })}
            </p>
            <SendCodeForm token={token} resend={false} />
          </>
        ) : link.status === "opened" ? (
          <>
            <VerifyCodeForm token={token} contact={link.maskedContact} />
            <SendCodeForm token={token} resend />
          </>
        ) : link.status === "verified" ? (
          <>
            <p className="text-ink-muted">
              {t.rich("answerHint", {
                deadline: (chunks) => (
                  <time dateTime={link.answerBy.toISOString()}>{chunks}</time>
                ),
                answerBy: format.dateTime(link.answerBy, "longDateTime"),
              })}
            </p>
            <AnswersForm token={token} uses={link.uses} />
          </>
        ) : null}
      </NextIntlClientProvider>
    </div>
  );
}
