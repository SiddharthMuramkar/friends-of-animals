import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/site/heading";
import { inlineLink } from "@/components/site/link-styles";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { phoneCodeAction } from "../_lib/phone-actions";
import { CodeForm } from "./code-form";
import { EmailOffCallout } from "./email-off-callout";
import { SmsOffCallout } from "./sms-off-callout";

type Intent = "sign-up" | "sign-in";

/**
 * The phone sign-up and sign-in pages: a heading, then the phone form, or
 * while SMS is switched off a note that codes come by email (or that
 * sign-in opens soon, while email is off too). Whether SMS
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
        <SiteLink href={other.path} className={inlineLink}>
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

  // With email off too, there is no way in yet: sign-in opens soon.
  if (!methods.phone && !methods.email) {
    return <EmailOffCallout intent={intent} className="mt-8 max-w-xl" />;
  }
  if (!methods.phone) {
    return <SmsOffCallout intent={intent} className="mt-8 max-w-xl" />;
  }

  return (
    <>
      <div className="mt-8 max-w-xl rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-8">
        <CodeForm
          action={phoneCodeAction}
          channel="phone"
          intent={intent}
          signUpPath={ROUTES.signUpPhone.path}
          emailPath={email.path}
          labels={{
            name: { label: tf("name.label"), hint: tf("name.hint") },
            contact: { label: tf("phone.label"), hint: tf("phone.hint") },
            code: { label: tf("code.label") },
            sendCode: tf("sendCode"),
            sending: tf("sending"),
            verify: intent === "sign-up" ? tf("signUp") : tf("signIn"),
            checking: tf("checking"),
            resend: tf("resend"),
            changeContact: tf("changePhone"),
            signUpInstead: tf("signUpInstead"),
            useEmail: t("useEmail"),
            problem: tc("danger"),
            done: tc("success"),
          }}
        />
      </div>
      <p className="mt-6">
        <SiteLink href={email.path} className={inlineLink}>
          {t("useEmail")}
        </SiteLink>
      </p>
    </>
  );
}
