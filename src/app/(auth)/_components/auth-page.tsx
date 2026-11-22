import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";

import { PageHeader } from "@/components/site/heading";
import { inlineLink } from "@/components/site/link-styles";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { emailCodeAction } from "../_lib/actions";
import { CodeForm } from "./code-form";
import { EmailOffCallout } from "./email-off-callout";
import { PhoneOption } from "./phone-option";

/**
 * The sign-up and sign-in pages: a heading, the form (or, while email
 * sign-in is off, a note that it opens soon), the other way in.
 * `consentField` is sign-up's optional messages consent box.
 */
export async function AuthPage({
  intent,
  consentField,
}: {
  intent: "sign-up" | "sign-in";
  consentField?: ReactNode;
}) {
  const page = await getTranslations(
    intent === "sign-up" ? "auth.signUp" : "auth.signIn"
  );
  const t = await getTranslations("auth");
  const other = intent === "sign-up" ? ROUTES.signIn : ROUTES.signUp;

  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={page("eyebrow")}
        tile="blue"
        title={page("title")}
        lead={page("lead")}
      />
      {/* Whether email sign-in is on is read per request, so the form
          streams in behind a boundary while the heading is prerendered. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <EmailMethod intent={intent} consentField={consentField} />
      </Suspense>
      {/* Whether SMS is on is read per request; the rest is prerendered. */}
      <Suspense fallback={null}>
        <PhoneOption intent={intent} />
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

async function EmailMethod({
  intent,
  consentField,
}: {
  intent: "sign-up" | "sign-in";
  consentField?: ReactNode;
}) {
  const [methods, t, tc] = await Promise.all([
    currentActor().then((actor) => as(actor).signInMethods()),
    getTranslations("auth.form"),
    getTranslations("common.callout"),
  ]);

  if (!methods.email) {
    return <EmailOffCallout intent={intent} className="mt-8 max-w-xl" />;
  }

  return (
    <div className="mt-8 max-w-xl rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-8">
      <CodeForm
        action={emailCodeAction}
        channel="email"
        intent={intent}
        signUpPath={ROUTES.signUp.path}
        consentField={consentField}
        labels={{
          name: { label: t("name.label"), hint: t("name.hint") },
          contact: { label: t("email.label"), hint: t("email.hint") },
          code: { label: t("code.label") },
          sendCode: t("sendCode"),
          sending: t("sending"),
          verify: intent === "sign-up" ? t("signUp") : t("signIn"),
          checking: t("checking"),
          resend: t("resend"),
          changeContact: t("changeEmail"),
          signUpInstead: t("signUpInstead"),
          problem: tc("danger"),
          done: tc("success"),
        }}
      />
    </div>
  );
}
