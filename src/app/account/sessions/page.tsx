import { MonitorSmartphone } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SubmitButton } from "@/components/form";
import { Chip } from "@/components/site/chip";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { formatPhoneNumber } from "@/lib/phone";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { SessionSummary } from "@/server/identity";

import { SessionSignOut, SignOutForm } from "./_components/session-sign-out";
import { signOutEverywhereAction } from "./_lib/actions";
import { sessionAddress } from "./_lib/address";
import { describeDevice } from "./_lib/device";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.sessions.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  const t = await getTranslations("account.sessions");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      {/* The account layout leaves the whole document to request time, so
          every script carries the request's CSP nonce. The heading streams
          first, and the session list streams in behind this boundary. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Sessions />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

async function Sessions() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, callout, format, account, sessions] = await Promise.all([
    getTranslations("account.sessions"),
    getTranslations("common.callout"),
    getFormatter(),
    as(actor).getAccount(),
    as(actor).listSessions(),
  ]);

  const deviceName = (session: SessionSummary) => {
    const { browser, os } = describeDevice(session.userAgent);
    if (browser && os) return t("device", { browser, os });
    if (browser) return t("deviceBrowserOnly", { browser });
    if (os) return t("deviceOsOnly", { os });
    return t("deviceUnknown");
  };

  return (
    <div className="mt-8 flex flex-col gap-10">
      {/* An email is one long word: let it break anywhere on a phone. */}
      <p className="text-lead text-ink wrap-anywhere">
        {t("signedInAs", {
          name: account.name,
          // Every account has an email or a phone.
          contact:
            account.email ??
            (account.phone ? formatPhoneNumber(account.phone) : ""),
        })}
      </p>

      {/* Says so above the list when a device is signed out. */}
      <SessionSignOut label={callout("success")} message={t("signedOut")}>
        <section aria-labelledby="sessions-list">
          <SectionHeading id="sessions-list" title={t("listTitle")} />
          <ul className="mt-5 flex flex-col gap-4">
            {sessions.map((session) => {
              const device = deviceName(session);
              const date = format.dateTime(session.startedAt, "longDateTime");
              const address = sessionAddress(session.ipAddress);
              return (
                <li key={session.id} className={CARD}>
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                    <MonitorSmartphone
                      aria-hidden="true"
                      className="size-5 shrink-0"
                    />
                    <span>{device}</span>
                    {session.current ? (
                      <Chip tone="green">{t("thisDevice")}</Chip>
                    ) : null}
                  </p>
                  <p className="mt-2 text-ink-muted">
                    {t("started", { date })}
                  </p>
                  {address ? (
                    <p className="text-ink-muted wrap-anywhere">
                      {t(address.kind, { address: address.text })}
                    </p>
                  ) : null}
                  <SignOutForm sessionId={session.id} className="mt-4">
                    <SubmitButton
                      variant="secondary"
                      pendingLabel={t("signingOut")}
                    >
                      {/* One sentence for screen readers, so it translates
                        whole; it starts with the visible words (WCAG
                        2.5.3). */}
                      <span aria-hidden="true">{t("signOut")}</span>
                      <span className="sr-only">
                        {t("signOutOf", { device, date })}
                      </span>
                    </SubmitButton>
                  </SignOutForm>
                </li>
              );
            })}
          </ul>
        </section>
      </SessionSignOut>

      <section aria-labelledby="sessions-everywhere" className={CARD}>
        <h2 id="sessions-everywhere" className="text-lead font-bold text-ink">
          {t("everywhereTitle")}
        </h2>
        <p className="mt-2 text-ink">{t("everywhereLead")}</p>
        <form action={signOutEverywhereAction} className="mt-4">
          <SubmitButton pendingLabel={t("signingOut")}>
            {t("everywhere")}
          </SubmitButton>
        </form>
      </section>
    </div>
  );
}
