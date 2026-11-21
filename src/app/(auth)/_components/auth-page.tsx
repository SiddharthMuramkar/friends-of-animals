import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/site/heading";
import { inlineLink } from "@/components/site/link-styles";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ROUTES } from "@/lib/routes";

import { emailCodeAction } from "../_lib/actions";
import { CodeForm } from "./code-form";
import { PhoneOption } from "./phone-option";

/** The sign-up and sign-in pages: a heading, the form, the other way in. */
export async function AuthPage({ intent }: { intent: "sign-up" | "sign-in" }) {
  const page = await getTranslations(
    intent === "sign-up" ? "auth.signUp" : "auth.signIn"
  );
  const t = await getTranslations("auth.form");
  const tc = await getTranslations("common.callout");
  const other = intent === "sign-up" ? ROUTES.signIn : ROUTES.signUp;

  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={page("eyebrow")}
        tile="blue"
        title={page("title")}
        lead={page("lead")}
      />
      <div className="mt-8 max-w-xl rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-8">
        <CodeForm
          action={emailCodeAction}
          channel="email"
          intent={intent}
          signUpPath={ROUTES.signUp.path}
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
