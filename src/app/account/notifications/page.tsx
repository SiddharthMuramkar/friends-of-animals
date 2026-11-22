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

import { ChannelChoice } from "./_components/channel-choice";
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
          <ChannelChoice
            id="channel-email"
            name="email"
            label={t("email")}
            defaultChecked={preferences.email}
            hint={
              <p>
                {account.email
                  ? t("emailTo", { email: account.email })
                  : t("emailNone")}
              </p>
            }
          />
          <ChannelChoice
            id="channel-sms"
            name="sms"
            label={t("sms")}
            defaultChecked={preferences.sms}
            hint={
              <>
                <p>
                  {account.phone
                    ? t("smsTo", { phone: formatPhoneNumber(account.phone) })
                    : t("smsNoPhone")}
                </p>
                {smsOn ? null : <p className="mt-1">{t("smsOff")}</p>}
              </>
            }
          />
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
