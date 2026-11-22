import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { Callout } from "@/components/site/callout";
import { Chip } from "@/components/site/chip";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES, guardianChildPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { as, currentActor } from "@/server/app";
import type { ChildSummary } from "@/server/modules/guardians";

// A guardian's children (#81): who they look after, the kind of profile
// each child's age gives, and where each child's own login stands. A
// member who hasn't registered or verified yet is pointed to that first.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("guardian.home.meta");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const HUE = "green";

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

export default async function Page() {
  const t = await getTranslations("guardian.home");
  return (
    <Section hue={HUE} tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile={HUE}
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Children />
      </Suspense>
    </Section>
  );
}

async function Children() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, profile] = await Promise.all([
    getTranslations("guardian.home"),
    as(actor).myGuardianProfile(),
  ]);

  if (!profile.registered) {
    return (
      <div className={cn(CARD, "mt-8")}>
        <p className="text-ink">{t("notRegistered.body")}</p>
        <div className="mt-4">
          <ButtonLink href={APP_ROUTES.guardianRegister}>
            {t("notRegistered.action")}
          </ButtonLink>
        </div>
      </div>
    );
  }
  if (!profile.verified) {
    return (
      <Callout tone="info" className="mt-8">
        <p>{t("unverified.body")}</p>
        <p>
          <ButtonLink href={APP_ROUTES.guardianRegister}>
            {t("unverified.action")}
          </ButtonLink>
        </p>
      </Callout>
    );
  }

  const children = await as(actor).listChildren();
  return (
    <div className="mt-8 flex flex-col gap-6">
      <p className="text-ink-muted">{t("verified")}</p>
      <section aria-labelledby="guardian-children">
        <SectionHeading id="guardian-children" title={t("listTitle")} />
        {children.length === 0 ? (
          <p className="mt-4 text-ink">{t("empty")}</p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {children.map((child) => (
              <li key={child.id}>
                <ChildCard child={child} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <div>
        <ButtonLink href={APP_ROUTES.guardianNewChild}>
          {t("addChild")}
        </ButtonLink>
      </div>
    </div>
  );
}

/** What the chip says about a child's profile and login. */
function kindLabel(child: ChildSummary) {
  if (child.kind === "adult") return "adult" as const;
  if (child.kind === "managed") return "managed" as const;
  if (child.login === "linked") return "linked" as const;
  return child.login === "invited" ? "invited" : "teenNoLogin";
}

const KIND_TONE = {
  managed: "neutral",
  linked: "green",
  invited: "marigold",
  teenNoLogin: "blue",
  adult: "neutral",
} as const;

async function ChildCard({ child }: { child: ChildSummary }) {
  const t = await getTranslations("guardian.home");
  const headingId = `child-${child.id}`;
  const kind = kindLabel(child);
  return (
    <article aria-labelledby={headingId} className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={headingId} className="text-h4 leading-tight wrap-anywhere">
          <SiteLink
            href={guardianChildPath(child.id)}
            className="text-link underline decoration-2 underline-offset-4 hover:text-link-hover"
          >
            {child.fullName}
          </SiteLink>
        </h3>
        <Chip tone={KIND_TONE[kind]}>{t(`kind.${kind}`)}</Chip>
      </div>
      <p className="mt-2 text-ink-muted">{t("age", { age: child.age })}</p>
    </article>
  );
}
