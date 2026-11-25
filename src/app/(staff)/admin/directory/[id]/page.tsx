import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ListingStatusChip } from "@/components/directory/listing-status-chip";
import { FormAlert, SubmitButton } from "@/components/form";
import { DetailList } from "@/components/institutions/detail-list";
import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ADMIN_DIRECTORY, publicListingPath } from "@/lib/app-routes";
import { formatPhoneNumber, type E164Phone } from "@/lib/phone";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import {
  STATUS_REASON_MAX_LENGTH,
  type ListingForReview,
} from "@/server/modules/directory";

import {
  DecisionForm,
  type DecisionFormLabels,
} from "./_components/decision-form";
import { openDocumentAction } from "./_lib/actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminDirectory.review.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/admin/directory/[id]">;

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("adminDirectory");
  return (
    <Section hue="neutral" width="prose" className="pt-10 sm:pt-14">
      <ButtonLink href={ADMIN_DIRECTORY} variant="quiet" className="-ms-5 mb-4">
        {t("review.back")}
      </ButtonLink>
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Review params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const OUTCOMES = ["verified", "rejected", "suspended", "reinstated"] as const;

async function Review({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, query, t, callout] = await Promise.all([
    params,
    searchParams,
    getTranslations("adminDirectory"),
    getTranslations("common.callout"),
  ]);

  let result;
  try {
    result = await as(actor).getListingForReview({ listingId: id });
  } catch (error) {
    if (!(error instanceof DomainError && error.code === "forbidden")) {
      throw error;
    }
    return (
      <>
        <PageHeader title={t("title")} />
        <ExplainState
          className="mt-8"
          title={t("forbidden.title")}
          back={{ href: ROUTES.home.path, label: t("forbidden.back") }}
        >
          <p>{t("forbidden.body")}</p>
        </ExplainState>
      </>
    );
  }
  if (!result.ok) {
    return (
      <>
        <PageHeader title={t("review.notFound.title")} />
        <p className="mt-5 max-w-prose text-lead text-ink-muted">
          {t("review.notFound.body")}
        </p>
      </>
    );
  }

  const { listing } = result;
  const outcome = OUTCOMES.find((each) => each === query.decided);
  const labels: DecisionFormLabels = {
    reason: {
      label: t("review.reason.label"),
      hint: t("review.reason.hint", { max: STATUS_REASON_MAX_LENGTH }),
    },
    errors: {
      reason_required: t("review.reason.required"),
      reason_too_long: t("review.reason.tooLong", {
        max: STATUS_REASON_MAX_LENGTH,
      }),
    },
    alerts: {
      transition_not_allowed: t("review.alerts.transition_not_allowed"),
      unexpected: t("review.alerts.unexpected"),
    },
    decide: {
      verify: t("review.decide.verify"),
      reject: t("review.decide.reject"),
      suspend: t("review.decide.suspend"),
      reinstate: t("review.decide.reinstate"),
    },
    deciding: t("review.deciding"),
    problem: callout("danger"),
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={listing.name}
        className="wrap-anywhere"
      />
      {outcome ? (
        <FormAlert tone="success" label={callout("success")}>
          <p>{t(`review.decided.${outcome}`)}</p>
        </FormAlert>
      ) : null}
      {query.document === "unavailable" ? (
        <FormAlert tone="danger" label={callout("danger")}>
          <p>{t("review.documentUnavailable")}</p>
        </FormAlert>
      ) : null}
      <Details listing={listing} />
      <Documents listing={listing} />
      <section aria-labelledby="review-decision" className={CARD}>
        <SectionHeading
          id="review-decision"
          title={t("review.decisionTitle")}
        />
        <div className="mt-5">
          {listing.allowedActions.length === 0 ? (
            <p className="text-ink">{t("review.noDecision")}</p>
          ) : (
            <DecisionForm
              listingId={listing.id}
              decisions={listing.allowedActions}
              maxReasonLength={STATUS_REASON_MAX_LENGTH}
              labels={labels}
            />
          )}
        </div>
      </section>
    </div>
  );
}

async function Details({ listing }: { listing: ListingForReview }) {
  const [t, statuses, types, services, contacts, format] = await Promise.all([
    getTranslations("adminDirectory.review"),
    getTranslations("directory.status"),
    getTranslations("directory.type"),
    getTranslations("directory.services"),
    getTranslations("directory.public"),
    getFormatter(),
  ]);
  const none = t("details.none");
  return (
    <section aria-labelledby="review-details" className={CARD}>
      <SectionHeading id="review-details" title={t("detailsTitle")} />
      <p className="mt-4 flex flex-wrap items-center gap-2">
        <ListingStatusChip
          status={listing.status}
          label={statuses(listing.status)}
        />
        <span className="text-ink-muted">
          {t("registeredOn", {
            date: format.dateTime(listing.registeredAt, "long"),
          })}
        </span>
      </p>
      <div className="mt-5">
        <DetailList
          items={[
            {
              label: t("registeredBy"),
              value: listing.owner
                ? [listing.owner.name, listing.owner.email]
                    .filter(Boolean)
                    .join(", ")
                : none,
            },
            ...(listing.statusReason
              ? [{ label: t("details.reason"), value: listing.statusReason }]
              : []),
            { label: t("details.type"), value: types(listing.type) },
            {
              label: t("details.services"),
              value: format.list(
                listing.services.map((service) => services(service)),
                "and"
              ),
            },
            {
              label: t("details.description"),
              value: (
                <span className="whitespace-pre-line">
                  {listing.description}
                </span>
              ),
            },
            { label: t("details.address"), value: listing.address },
            {
              label: t("details.place"),
              value: t("place_value", {
                city: listing.city,
                state: listing.state,
                pinCode: listing.pinCode,
              }),
            },
            {
              label: t("details.contactPhone"),
              value: formatPhoneNumber(listing.contactPhone as E164Phone),
            },
            {
              label: t("details.contactEmail"),
              value: listing.contactEmail ?? none,
            },
            { label: t("details.website"), value: listing.website ?? none },
            {
              label: t("details.publicContacts"),
              value:
                listing.publicContactFields.length === 0
                  ? none
                  : format.list(
                      listing.publicContactFields.map((field) =>
                        contacts(field)
                      ),
                      "and"
                    ),
            },
          ]}
        />
      </div>
      {listing.status === "verified" ? (
        <div className="mt-6">
          <ButtonLink
            href={publicListingPath(listing.slug)}
            variant="secondary"
          >
            {t("publicPage")}
          </ButtonLink>
        </div>
      ) : null}
    </section>
  );
}

async function Documents({ listing }: { listing: ListingForReview }) {
  const [t, kinds, fileStatuses, format] = await Promise.all([
    getTranslations("adminDirectory.review"),
    getTranslations("directory.documentKind"),
    getTranslations("directory.fileStatus"),
    getFormatter(),
  ]);
  return (
    <section aria-labelledby="review-documents" className={CARD}>
      <SectionHeading id="review-documents" title={t("documentsTitle")} />
      <p className="mt-3 text-ink-muted">{t("documentsLead")}</p>
      {listing.documents.length === 0 ? (
        <p className="mt-4 text-ink">{t("noDocuments")}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {listing.documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-col gap-2 border-b border-border pb-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold text-ink">{kinds(document.kind)}</p>
                <p className="text-sm text-ink-muted">
                  {fileStatuses(document.fileStatus)}
                  {" · "}
                  {format.dateTime(document.uploadedAt, "long")}
                </p>
              </div>
              {document.fileStatus === "clean" ? (
                <form action={openDocumentAction}>
                  <input type="hidden" name="listingId" value={listing.id} />
                  <input type="hidden" name="documentId" value={document.id} />
                  <SubmitButton variant="secondary" pendingLabel={t("opening")}>
                    {t("open", { kind: kinds(document.kind) })}
                  </SubmitButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <h3 className="mt-6 text-lead font-bold text-ink">
        {t("checklistTitle")}
      </h3>
      <p className="mt-1 text-sm text-ink-muted">{t("checklistNote")}</p>
      <ul className="mt-3 flex flex-col gap-1">
        {listing.checklist.map((item) => (
          <li key={item.kind} className="text-ink">
            {kinds(item.kind)}
            {" · "}
            {t(`expected.${item.expected}`)}
            {" · "}
            {item.provided ? t("provided") : t("missing")}
          </li>
        ))}
      </ul>
    </section>
  );
}
