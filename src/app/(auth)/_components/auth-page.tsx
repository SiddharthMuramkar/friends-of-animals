import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";

import { PageHeader } from "@/components/site/heading";
import { inlineLink } from "@/components/site/link-styles";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { signInNext } from "@/lib/sign-in-next";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { emailCodeAction } from "../_lib/actions";
import { CodeForm } from "./code-form";
import { EmailOffCallout } from "./email-off-callout";
import { PhoneOption } from "./phone-option";

/**
 * The sign-up and sign-in pages: a heading, the form (or, while email
 * sign-in is off, a note that it opens soon), the other way in.
 * `consentField` is sign-up's optional messages consent box; `art`, a
 * small decorative drawing beside the form card (80px wide at most).
 */
export async function AuthPage({
  intent,
  consentField,
  art,
  searchParams,
}: {
  intent: "sign-up" | "sign-in";
  consentField?: ReactNode;
  art?: ReactNode;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
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
        <EmailMethod
          intent={intent}
          consentField={consentField}
          art={art}
          searchParams={searchParams}
        />
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
  art,
  searchParams,
}: {
  intent: "sign-up" | "sign-in";
  consentField?: ReactNode;
  art?: ReactNode;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [methods, t, tc] = await Promise.all([
    currentActor().then((actor) => as(actor).signInMethods()),
    getTranslations("auth.form"),
    getTranslations("common.callout"),
  ]);

  const next = signInNext((await searchParams)?.next);
  // Out in the free space beside the card, from md: the 576px card, a 24px
  // gap and the 80px drawing fit the 720px prose column.
  const drawing = art ? (
    <span className="absolute top-4 left-full ms-6 hidden md:block">{art}</span>
  ) : null;

  if (!methods.email) {
    return (
      <div className="relative mt-8 max-w-xl">
        <EmailOffCallout intent={intent} />
        {drawing}
      </div>
    );
  }

  return (
    <div className="relative mt-8 max-w-xl rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-8">
      <CodeForm
        action={emailCodeAction}
        channel="email"
        intent={intent}
        signUpPath={
          next
            ? `${ROUTES.signUp.path}?next=${encodeURIComponent(next)}`
            : ROUTES.signUp.path
        }
        next={next ?? undefined}
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
      {drawing}
    </div>
  );
}
