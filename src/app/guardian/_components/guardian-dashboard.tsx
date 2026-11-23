import { getTranslations } from "next-intl/server";

import { ButtonLink } from "@/components/site/button-link";
import { Callout } from "@/components/site/callout";
import { Chip } from "@/components/site/chip";
import { SectionHeading } from "@/components/site/heading";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES, guardianChildPath } from "@/lib/app-routes";
import { cn } from "@/lib/utils";
import type { ChildSummary } from "@/server/modules/guardians";
import type { MyGuardianProfile } from "@/server/modules/guardians/register-guardian";

import { GuardianSetupUnavailable } from "./setup-unavailable";

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

export async function GuardianDashboard({
  profile,
  childProfiles,
  setupAvailable,
}: {
  profile: MyGuardianProfile;
  childProfiles: ChildSummary[];
  setupAvailable: boolean;
}) {
  if (!setupAvailable && !(profile.registered && profile.verified)) {
    return <GuardianSetupUnavailable />;
  }
  const t = await getTranslations("guardian.home");
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

  return (
    <div className="mt-8 flex flex-col gap-6">
      <p className="text-ink-muted">{t("verified")}</p>
      <section aria-labelledby="guardian-children">
        <SectionHeading id="guardian-children" title={t("listTitle")} />
        {childProfiles.length === 0 ? (
          <p className="mt-4 text-ink">{t("empty")}</p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {childProfiles.map((child) => (
              <li key={child.id}>
                <ChildCard child={child} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {setupAvailable ? (
        <div>
          <ButtonLink href={APP_ROUTES.guardianNewChild}>
            {t("addChild")}
          </ButtonLink>
        </div>
      ) : (
        <GuardianSetupUnavailable />
      )}
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
