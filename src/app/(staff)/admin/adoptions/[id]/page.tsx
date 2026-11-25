import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  ApplicantDetailsList,
  ApplicationStatusChip,
} from "@/components/adoption/application-parts";
import { AdoptionDisclaimer } from "@/components/adoption/disclaimer";
import { FormAlert, SubmitButton, TextAreaField } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import {
  ADMIN_ADOPTIONS,
  adminAdoptionApplicationPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { CoordinatorApplicationView } from "@/server/modules/adoption/applications";
import { OUTCOME_REASON_MAX_LENGTH } from "@/server/modules/adoption/domain/application-status";

import { AdminDenied } from "../../_components/admin-denied";
import { adminCall } from "../../_lib/boundary";
import { moveApplicationAction, publishStoryAction } from "../_lib/actions";

// One adoption application as the coordinator handles it (#130): the
// applicant, their contact and answers; the moves the transition table
// allows from its status; and after an adoption, the adopter's success
// story, which is published only while they consent.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adoptionApplications.admin.detail.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/admin/adoptions/[id]">;

export default async function Page(props: Props) {
  const t = await getTranslations("adoptionApplications.admin");
  return (
    <>
      <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
        <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
          <Application {...props} />
        </Suspense>
      </Section>
      <Section hue="green" width="prose" className="py-8 sm:py-10">
        <AdoptionDisclaimer />
      </Section>
    </>
  );
}

const CARD =
  "flex flex-col gap-4 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const DONE = [
  "under_review",
  "in_contact",
  "adopted",
  "not_matched",
  "declined",
  "published",
] as const;
const REFUSED = [
  "invalid_transition",
  "reason_required",
  "reason_too_long",
  "sharing_consent_missing",
  "listing_not_open",
  "consent_required",
  "no_story",
  "forbidden_actor",
  "invalid_input",
  "forbidden",
] as const;

async function Application({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [t, callout, facts, format, loaded] = await Promise.all([
    getTranslations("adoptionApplications.admin.detail"),
    getTranslations("common.callout"),
    getTranslations("adoptionApplications.facts"),
    getFormatter(),
    adminCall(
      () => as(actor).getAdoptionApplication({ applicationId: id }),
      adminAdoptionApplicationPath(id)
    ),
  ]);
  if (!loaded.ok || "ok" in loaded.value) return <AdminDenied />;
  const application = loaded.value;
  const done = DONE.find((each) => each === query.done) ?? null;
  const refused = REFUSED.find((each) => each === query.refused) ?? null;
  const names = {
    applicant: application.applicant.name,
    name: application.animal.name,
    organisation: application.organisation.name,
  };

  return (
    <div className="flex flex-col gap-8">
      <ButtonLink
        href={ADMIN_ADOPTIONS}
        variant="quiet"
        className="-ms-5 self-start"
      >
        {t("back")}
      </ButtonLink>
      <PageHeader
        eyebrow={facts("applied", {
          date: format.dateTime(application.createdAt, "long"),
        })}
        tile="green"
        title={t("title", names)}
        className="wrap-anywhere"
      />
      <p className="-mt-4">
        <ApplicationStatusChip status={application.status} />
      </p>
      {done ? (
        <FormAlert tone="success" label={callout("success")}>
          <p>{t(`done.${done}`)}</p>
        </FormAlert>
      ) : null}
      {refused ? (
        <FormAlert tone="danger" label={callout("danger")}>
          <p>{t(`refused.${refused}`)}</p>
        </FormAlert>
      ) : null}

      <Moves application={application} />

      <section aria-labelledby="applicant" className={CARD}>
        <SectionHeading id="applicant" title={t("applicant")} />
        <ApplicantDetailsList
          details={application.details}
          name={{ label: t("email"), value: application.applicant.email ?? "" }}
        />
        <p className="text-sm text-ink-muted">
          {t("dateOfBirth", { date: application.dateOfBirth })}
        </p>
        {application.contactSharedAt ? (
          <p className="text-sm text-ink-muted">
            {t("contactShared", {
              date: format.dateTime(application.contactSharedAt, "long"),
            })}
          </p>
        ) : null}
        {application.outcomeReason ? (
          <div>
            <h3 className="font-semibold text-ink">{t("reason")}</h3>
            <p className="text-ink whitespace-pre-line wrap-anywhere">
              {application.outcomeReason}
            </p>
          </div>
        ) : null}
      </section>

      <Story application={application} />
    </div>
  );
}

function MoveForm({
  applicationId,
  move,
  label,
  hint,
}: {
  applicationId: string;
  move: "start_review" | "put_in_contact" | "adopted";
  label: string;
  hint?: string;
}) {
  return (
    <form
      action={moveApplicationAction.bind(null, applicationId)}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="move" value={move} />
      {hint ? <p className="text-sm text-ink-muted">{hint}</p> : null}
      <div>
        <SubmitButton pendingLabel={label}>{label}</SubmitButton>
      </div>
    </form>
  );
}

async function Moves({
  application,
}: {
  application: CoordinatorApplicationView;
}) {
  const t = await getTranslations("adoptionApplications.admin.detail");
  const { status, id } = application;
  const names = {
    name: application.animal.name,
    organisation: application.organisation.name,
  };
  const open =
    status === "submitted" ||
    status === "under_review" ||
    status === "in_contact";
  if (!open) return null;
  return (
    <section aria-labelledby="moves" className={CARD}>
      <SectionHeading id="moves" title={t("moves")} />
      {status === "submitted" ? (
        <MoveForm
          applicationId={id}
          move="start_review"
          label={t("startReview")}
        />
      ) : null}
      {status === "under_review" ? (
        <MoveForm
          applicationId={id}
          move="put_in_contact"
          label={t("putInContact", names)}
          hint={t("putInContactHint")}
        />
      ) : null}
      {status === "in_contact" ? (
        <MoveForm
          applicationId={id}
          move="adopted"
          label={t("adopted")}
          hint={t("adoptedHint", names)}
        />
      ) : null}
      <form
        action={moveApplicationAction.bind(null, id)}
        className="flex flex-col gap-4 border-t-2 border-border pt-4"
      >
        <input type="hidden" name="move" value="end" />
        <h3 className="text-lead font-bold text-ink">{t("endTitle")}</h3>
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold text-ink">{t("outcome")}</legend>
          {(status === "submitted"
            ? (["declined"] as const)
            : (["not_matched", "declined"] as const)
          ).map((value, index) => (
            <label
              key={value}
              className="flex min-h-11 items-center gap-3 text-ink"
            >
              <input
                type="radio"
                name="outcome"
                value={value}
                defaultChecked={index === 0}
                className="size-6 shrink-0 accent-primary"
              />
              <span>
                {value === "declined"
                  ? t("outcomeDeclined")
                  : t("outcomeNotMatched")}
              </span>
            </label>
          ))}
        </fieldset>
        <TextAreaField
          id="end-reason"
          name="reason"
          rows={3}
          maxLength={OUTCOME_REASON_MAX_LENGTH}
          label={t("reasonLabel")}
          required
        />
        <div>
          <SubmitButton variant="secondary" pendingLabel={t("end")}>
            {t("end")}
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}

async function Story({
  application,
}: {
  application: CoordinatorApplicationView;
}) {
  if (application.status !== "adopted") return null;
  const [t, storyStatus] = await Promise.all([
    getTranslations("adoptionApplications.admin.detail"),
    getTranslations("adoptionApplications.storyStatus"),
  ]);
  const { story } = application;
  return (
    <section aria-labelledby="story" className={CARD}>
      <SectionHeading id="story" title={t("story")} />
      {story ? (
        <>
          <p>
            <Chip tone={story.status === "published" ? "green" : "neutral"}>
              {storyStatus(story.status)}
            </Chip>
          </p>
          <p className="text-ink whitespace-pre-line wrap-anywhere">
            {story.body}
          </p>
          <p className="text-sm text-ink-muted">
            {t("storyConsent", {
              state: application.storyConsentGiven ? "given" : "withdrawn",
            })}
          </p>
          {story.status === "draft" ? (
            <form action={publishStoryAction.bind(null, application.id)}>
              <SubmitButton pendingLabel={t("publish")}>
                {t("publish")}
              </SubmitButton>
            </form>
          ) : null}
        </>
      ) : (
        <p className="text-ink">{t("noStory")}</p>
      )}
    </section>
  );
}
