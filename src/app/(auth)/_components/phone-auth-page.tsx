import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { phoneCodeAction } from "../_lib/phone-actions";
import { PhoneCodeForm } from "./phone-code-form";
import { SmsOffNotice } from "./sms-off-notice";

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

type Intent = "sign-up" | "sign-in";

/**
 * The phone sign-up and sign-in pages: a heading, then the phone form, or
 * while SMS is switched off a note that codes come by email. Whether SMS
 * is on is read per request, so that part streams in behind a boundary
 * while the heading is prerendered.
 */
export async function PhoneAuthPage({ intent }: { intent: Intent }) {
  const page = await getTranslations(
    intent === "sign-up" ? "authPhone.signUp" : "authPhone.signIn"
  );
  const t = await getTranslations("authPhone");
  const other = intent === "sign-up" ? ROUTES.signInPhone : ROUTES.signUpPhone;

  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={page("eyebrow")}
        tile="blue"
        title={page("title")}
        lead={page("lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <PhoneMethod intent={intent} />
      </Suspense>
      <p className="mt-6 text-ink">
        {page("other")}{" "}
        <SiteLink href={other.path} className={LINK}>
          {page("otherLink")}
        </SiteLink>
      </p>
    </Section>
  );
}

async function PhoneMethod({ intent }: { intent: Intent }) {
  const [methods, t, tf, tc] = await Promise.all([
    currentActor().then((actor) => as(actor).signInMethods()),
    getTranslations("authPhone"),
    getTranslations("authPhone.form"),
    getTranslations("common.callout"),
  ]);
  const email = intent === "sign-up" ? ROUTES.signUp : ROUTES.signIn;

  if (!methods.phone) {
    return (
      <div className="mt-8 max-w-xl">
        <SmsOffNotice
          label={tc("info")}
          message={t("off.message")}
          link={{
            href: email.path,
            text: intent === "sign-up" ? t("off.signUp") : t("off.signIn"),
          }}
        />
      </div>
    );
  }

  return (
    <>
      <div className="mt-8 max-w-xl rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-8">
        <PhoneCodeForm
          action={phoneCodeAction}
          intent={intent}
          signUpPath={ROUTES.signUpPhone.path}
          emailPath={email.path}
          labels={{
            name: { label: tf("name.label"), hint: tf("name.hint") },
            phone: { label: tf("phone.label"), hint: tf("phone.hint") },
            code: { label: tf("code.label") },
            sendCode: tf("sendCode"),
            sending: tf("sending"),
            verify: intent === "sign-up" ? tf("signUp") : tf("signIn"),
            checking: tf("checking"),
            resend: tf("resend"),
            changePhone: tf("changePhone"),
            signUpInstead: tf("signUpInstead"),
            useEmail: t("useEmail"),
            problem: tc("danger"),
            done: tc("success"),
          }}
        />
      </div>
      <p className="mt-6">
        <SiteLink href={email.path} className={LINK}>
          {t("useEmail")}
        </SiteLink>
      </p>
    </>
  );
}
