import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { SubmitButton } from "@/components/form";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";

import { withdrawByLinkAction } from "./_lib/actions";

// A campaign message's withdrawal link (#126). The token in the address is
// its only key: the page is never indexed, analytics leaves the prefix
// out, and opening it changes nothing (mail scanners open links). The
// button withdraws.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("campaigns.withdrawal.meta");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Props = PageProps<"/withdraw/[token]">;

export default async function Page({ params }: Props) {
  const t = await getTranslations("campaigns.withdrawal");
  return (
    <Section hue="teal" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader tile="teal" title={t("title")} />
      {/* The link is read per request, behind this boundary. */}
      <Suspense
        fallback={<p className="mt-6 text-ink-muted">{t("loading")}</p>}
      >
        <WithdrawalLink params={params} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "mt-8 flex flex-col gap-4 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

async function WithdrawalLink({ params }: Pick<Props, "params">) {
  const [{ token }, actor, t] = await Promise.all([
    params,
    currentActor(),
    getTranslations("campaigns.withdrawal"),
  ]);
  const link = await as(actor).viewWithdrawalLink({ token });
  const account = { href: APP_ROUTES.accountConsents, label: t("account") };

  if (!link.ok) {
    return (
      <ExplainState className="mt-8" title={t("notFound.title")} back={account}>
        <p>{t("notFound.body")}</p>
      </ExplainState>
    );
  }
  if (link.status === "done") {
    return (
      <ExplainState className="mt-8" title={t("done.title")} back={account}>
        <p>{t("done.body")}</p>
      </ExplainState>
    );
  }
  return (
    <div className={CARD}>
      <p className="text-lead text-ink">{t("open.lead")}</p>
      {link.ownConsent ? <p>{t("open.own")}</p> : null}
      {link.children > 0 ? (
        <p>{t("open.children", { count: link.children })}</p>
      ) : null}
      <p className="text-ink-muted">{t("open.after")}</p>
      <form action={withdrawByLinkAction.bind(null, token)}>
        <SubmitButton pendingLabel={t("open.submitting")}>
          {t("open.submit")}
        </SubmitButton>
      </form>
    </div>
  );
}
