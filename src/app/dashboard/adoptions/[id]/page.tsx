import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  ApplicantDetailsList,
  ApplicationStatusChip,
} from "@/components/adoption/application-parts";
import { SubmitButton, TextAreaField } from "@/components/form";
import { OutcomeNotice } from "@/components/form/outcome-notice";
import {
  LegalSectionsText,
  LegalShortList,
} from "@/components/legal/legal-text";
import { Chip } from "@/components/site/chip";
import { Disclosure } from "@/components/site/disclosure";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { inlineLink } from "@/components/site/link-styles";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { DASHBOARD_ADOPTIONS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import type { MyAdoptionApplication } from "@/server/modules/adoption/applications";
import { isOpenAdoptionApplication } from "@/server/modules/adoption/domain/application-status";
import { STORY_TEXT_MAX_LENGTH } from "@/server/modules/adoption/domain/success-story";

import {
  storyAction,
  withdrawAction,
  withdrawStoryConsentAction,
} from "../_lib/actions";

// One of the signed-in user's adoption applications (#130): where it
// stands, what they told FOA, withdrawing it while it is open, and after an
// adoption, sharing a success story with their consent, or withdrawing
// that consent.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adoptionApplications.detail.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/dashboard/adoptions/[id]">;

export default async function Page(props: Props) {
  const t = await getTranslations("adoptionApplications.mine");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Application {...props} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "flex flex-col gap-4 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const OUTCOMES = [
  "applied",
  "withdrawn",
  "storySent",
  "storyWithdrawn",
  "invalid_transition",
  "not_adopted",
  "story_exists",
  "consent_unpublished",
  "consent_outdated",
  "invalid_input",
  "unexpected",
] as const;
type Outcome = (typeof OUTCOMES)[number];
const SUCCESSES: ReadonlySet<Outcome> = new Set([
  "applied",
  "withdrawn",
  "storySent",
  "storyWithdrawn",
]);

async function load(
  actor: Parameters<typeof as>[0],
  applicationId: string
): Promise<MyAdoptionApplication | null> {
  try {
    const result = await as(actor).myAdoptionApplication({ applicationId });
    return "ok" in result ? null : result;
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") return null;
    throw error;
  }
}

async function Application({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, query, t, mine, callout, facts, format] = await Promise.all([
    params,
    searchParams,
    getTranslations("adoptionApplications.detail"),
    getTranslations("adoptionApplications.mine"),
    getTranslations("common.callout"),
    getTranslations("adoptionApplications.facts"),
    getFormatter(),
  ]);
  const application = await load(actor, id);
  if (!application) {
    return (
      <ExplainState
        headingLevel="h1"
        title={t("meta.title")}
        back={{ href: DASHBOARD_ADOPTIONS, label: mine("title") }}
      >
        <p>{mine("empty")}</p>
      </ExplainState>
    );
  }
  const done = OUTCOMES.find((outcome) => outcome === query.done) ?? null;
  const names = {
    name: application.animal.name,
    organisation: application.organisation.name,
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={t("title", names)}
        lead={t("listedBy", names)}
        className="wrap-anywhere"
      />
      {done ? (
        <OutcomeNotice
          key={typeof query.n === "string" ? query.n : done}
          tone={SUCCESSES.has(done) ? "success" : "danger"}
          label={SUCCESSES.has(done) ? callout("success") : callout("danger")}
          message={mine(`outcome.${done}`)}
        />
      ) : null}

      <section aria-labelledby="where" className={CARD}>
        <div className="flex flex-wrap items-center gap-3">
          <SectionHeading id="where" title={t("what")} />
          <ApplicationStatusChip status={application.status} />
        </div>
        <p className="text-ink">{t(`next.${application.status}`, names)}</p>
        <p className="text-sm text-ink-muted">
          {facts("applied", {
            date: format.dateTime(application.createdAt, "long"),
          })}{" "}
          ·{" "}
          {facts("updated", {
            date: format.dateTime(application.updatedAt, "long"),
          })}
        </p>
        {isOpenAdoptionApplication(application.status) ? (
          <form action={withdrawAction.bind(null, application.id)}>
            <SubmitButton variant="secondary" pendingLabel={t("withdrawing")}>
              {t("withdraw")}
            </SubmitButton>
          </form>
        ) : null}
      </section>

      <Story application={application} />

      <section aria-labelledby="answers" className={CARD}>
        <SectionHeading id="answers" title={t("yourAnswers")} />
        <ApplicantDetailsList details={application.details} />
      </section>

      <p>
        <SiteLink href={DASHBOARD_ADOPTIONS} className={inlineLink}>
          {mine("title")}
        </SiteLink>
      </p>
    </div>
  );
}

async function Story({ application }: { application: MyAdoptionApplication }) {
  if (application.status !== "adopted") return null;
  const [t, storyStatus] = await Promise.all([
    getTranslations("adoptionApplications.detail.story"),
    getTranslations("adoptionApplications.storyStatus"),
  ]);
  const name = application.animal.name;
  const { story, storyConsentDocument: document } = application;
  return (
    <>
      {story ? (
        <section aria-labelledby="story" className={CARD}>
          <div className="flex flex-wrap items-center gap-3">
            <SectionHeading id="story" title={t("yours")} />
            <Chip tone={story.status === "published" ? "green" : "neutral"}>
              {storyStatus(story.status)}
            </Chip>
          </div>
          <p className="text-ink whitespace-pre-line wrap-anywhere">
            {story.body}
          </p>
        </section>
      ) : null}
      {application.canWriteStory ? (
        <section aria-labelledby="story-form" className={CARD}>
          <SectionHeading id="story-form" title={t("title")} />
          <p className="text-ink">{t("lead", { name })}</p>
          {document ? (
            <form
              action={storyAction.bind(null, application.id)}
              className="flex flex-col gap-5"
            >
              <TextAreaField
                id="story-body"
                name="body"
                label={t("label")}
                hint={t("hint")}
                rows={6}
                required
                minLength={20}
                maxLength={STORY_TEXT_MAX_LENGTH}
              />
              <div className="flex flex-col gap-3">
                <h3 className="text-lead font-bold text-ink">
                  {document.title}
                </h3>
                <LegalShortList
                  id="story-consent-points"
                  points={document.body.short}
                  className="list-disc space-y-1 pl-5 text-ink"
                />
                <Disclosure
                  summary={t("readFull", { version: document.version })}
                  className="rounded-2xl"
                >
                  <LegalSectionsText
                    sections={document.body.sections}
                    level="h4"
                  />
                </Disclosure>
                <label className="flex min-h-11 items-start gap-3 font-semibold text-ink">
                  <input
                    type="checkbox"
                    name="consentDocumentId"
                    value={document.id}
                    required
                    className="mt-0.5 size-6 shrink-0 accent-primary"
                  />
                  <span className="min-w-0">{t("consent")}</span>
                </label>
              </div>
              <div>
                <SubmitButton pendingLabel={t("submitting")}>
                  {t("submit")}
                </SubmitButton>
              </div>
            </form>
          ) : (
            <p className="text-ink">{t("unpublished")}</p>
          )}
        </section>
      ) : null}
      {application.storyConsentGiven ? (
        <section aria-labelledby="story-withdraw" className={CARD}>
          <SectionHeading id="story-withdraw" title={t("withdrawTitle")} />
          <p className="text-ink">{t("withdrawBody")}</p>
          <form action={withdrawStoryConsentAction.bind(null, application.id)}>
            <SubmitButton variant="secondary" pendingLabel={t("withdrawing")}>
              {t("withdraw")}
            </SubmitButton>
          </form>
        </section>
      ) : null}
    </>
  );
}
