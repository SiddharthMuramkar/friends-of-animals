import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { FormAlert, SubmitButton } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES } from "@/lib/app-routes";
import { formatPhoneNumber } from "@/lib/phone";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { savePreferencesAction } from "./_lib/actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notificationSettings.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type SearchParams = PageProps<"/account/notifications">["searchParams"];

export default async function Page({
  searchParams,
}: PageProps<"/account/notifications">) {
  const t = await getTranslations("notificationSettings");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Choices searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CHECKBOX =
  "mt-1 size-6 shrink-0 rounded-md border-2 border-border-strong accent-primary";

async function Choices({ searchParams }: { searchParams: SearchParams }) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, callout, preferences, account, methods, { saved, error }] =
    await Promise.all([
      getTranslations("notificationSettings"),
      getTranslations("common.callout"),
      as(actor).getNotificationPreferences(),
      as(actor).getAccount(),
      // Phone sign-in is on exactly while SMS is (sms.enabled).
      as(actor).signInMethods(),
      searchParams,
    ]);
  const smsOn = methods.phone;

  return (
    <div className="mt-8 flex flex-col gap-6">
      {typeof saved === "string" ? (
        <FormAlert key={saved} tone="success" label={callout("success")}>
          <p>{t("saved")}</p>
        </FormAlert>
      ) : error === "both-off" ? (
        <FormAlert tone="danger" label={callout("danger")}>
          <p>{t("bothOff")}</p>
        </FormAlert>
      ) : null}

      <form
        action={savePreferencesAction}
        className="rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6"
      >
        <fieldset className="flex flex-col gap-5">
          <legend className="text-lead font-bold text-ink">
            {t("legend")}
          </legend>
          <div className="flex items-start gap-3">
            <input
              id="channel-email"
              type="checkbox"
              name="email"
              defaultChecked={preferences.email}
              aria-describedby="channel-email-hint"
              className={CHECKBOX}
            />
            <div>
              <label
                htmlFor="channel-email"
                className="inline-flex min-h-8 items-center font-semibold text-ink"
              >
                {t("email")}
              </label>
              <p
                id="channel-email-hint"
                className="text-ink-muted wrap-anywhere"
              >
                {account.email
                  ? t("emailTo", { email: account.email })
                  : t("emailNone")}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <input
              id="channel-sms"
              type="checkbox"
              name="sms"
              defaultChecked={preferences.sms}
              aria-describedby="channel-sms-hint"
              className={CHECKBOX}
            />
            <div>
              <label
                htmlFor="channel-sms"
                className="inline-flex min-h-8 items-center font-semibold text-ink"
              >
                {t("sms")}
              </label>
              <div id="channel-sms-hint" className="text-ink-muted">
                <p>
                  {account.phone
                    ? t("smsTo", { phone: formatPhoneNumber(account.phone) })
                    : t("smsNoPhone")}
                </p>
                {smsOn ? null : <p className="mt-1">{t("smsOff")}</p>}
              </div>
            </div>
          </div>
        </fieldset>
        <SubmitButton pendingLabel={t("saving")} className="mt-6">
          {t("save")}
        </SubmitButton>
      </form>

      <p className="text-ink">{t("required")}</p>
      <p className="text-ink">{t("consent")}</p>
      <p>
        <ButtonLink href={APP_ROUTES.accountInbox} variant="secondary">
          {t("inbox")}
        </ButtonLink>
      </p>
    </div>
  );
}
