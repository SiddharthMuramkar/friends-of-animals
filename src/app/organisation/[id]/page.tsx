import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ListingStatusChip } from "@/components/directory/listing-status-chip";
import { FormAlert } from "@/components/form";
import { DetailList } from "@/components/institutions/detail-list";
import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { TableScroller } from "@/components/site/table-scroller";
import {
  adoptionsPath,
  editListingPath,
  MY_LISTINGS,
  publicListingPath,
} from "@/lib/app-routes";
import { formatPhoneNumber, type E164Phone } from "@/lib/phone";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import {
  DOCUMENT_KINDS,
  STATUS_REASON_MAX_LENGTH,
  type MyListing,
} from "@/server/modules/directory";

import {
  DocumentUpload,
  type DocumentUploadLabels,
} from "./_components/document-upload";
import { WithdrawForm } from "./_components/withdraw-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("directory.listing.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/organisation/[id]">;

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("directory.listing");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <ButtonLink href={MY_LISTINGS} variant="quiet" className="-ms-5 mb-4">
        {t("back")}
      </ButtonLink>
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Listing params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";
const CELL = "px-4 py-3 text-start align-top";

const NOTICES = [
  "saved",
  "savedPending",
  "resubmitted",
  "unchanged",
  "withdrawn",
] as const;

async function Listing({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, query, t, callout] = await Promise.all([
    params,
    searchParams,
    getTranslations("directory.listing"),
    getTranslations("common.callout"),
  ]);

  let listing: MyListing;
  try {
    const result = await as(actor).getMyListing({ listingId: id });
    if (!result.ok) throw new DomainError("forbidden", "not a listing id");
    listing = result.listing;
  } catch (error) {
    if (!(error instanceof DomainError && error.code === "forbidden")) {
      throw error;
    }
    return (
      <ExplainState
        headingLevel="h1"
        title={t("forbidden.title")}
        back={{ href: MY_LISTINGS, label: t("forbidden.back") }}
      >
        <p>{t("forbidden.body")}</p>
      </ExplainState>
    );
  }

  const saved = typeof query.saved === "string" ? query.saved : undefined;
  const notice = NOTICES.find((each) => each === saved);
  const noticeText =
    query.registered === "1"
      ? (await getTranslations("directory.mine"))("registered")
      : notice === "withdrawn"
        ? t("withdrawnNotice")
        : notice
          ? t(notice)
          : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={(await getTranslations("directory.mine"))("eyebrow")}
        tile="green"
        title={listing.name}
        className="wrap-anywhere"
      />
      {noticeText ? (
        <FormAlert tone="success" label={callout("success")}>
          <p>{noticeText}</p>
        </FormAlert>
      ) : null}
      <Details listing={listing} />
      {listing.status === "verified" || listing.status === "suspended" ? (
        <AdoptionsLink listingId={listing.id} />
      ) : null}
      <Documents listing={listing} />
      {listing.canWithdraw ? (
        <section aria-labelledby="withdraw-title" className={CARD}>
          <SectionHeading id="withdraw-title" title={t("withdraw.title")} />
          <p className="mt-3 text-ink">{t("withdraw.lead")}</p>
          <div className="mt-5">
            <WithdrawForm
              listingId={listing.id}
              maxReasonLength={STATUS_REASON_MAX_LENGTH}
              labels={{
                reason: {
                  label: t("withdraw.reason.label"),
                  hint: t("withdraw.reason.hint", {
                    max: STATUS_REASON_MAX_LENGTH,
                  }),
                },
                errors: {
                  reason_too_long: t("withdraw.errors.reason_too_long", {
                    max: STATUS_REASON_MAX_LENGTH,
                  }),
                  transition_not_allowed: t(
                    "withdraw.errors.transition_not_allowed"
                  ),
                  unexpected: t("withdraw.errors.unexpected"),
                },
                submit: t("withdraw.submit"),
                submitting: t("withdraw.submitting"),
                problem: callout("danger"),
              }}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

async function Details({ listing }: { listing: MyListing }) {
  const [t, statuses, types, services, contacts, format] = await Promise.all([
    getTranslations("directory.listing"),
    getTranslations("directory.status"),
    getTranslations("directory.type"),
    getTranslations("directory.services"),
    getTranslations("directory.public"),
    getFormatter(),
  ]);
  const none = t("details.none");
  return (
    <section aria-labelledby="listing-details" className={CARD}>
      <SectionHeading id="listing-details" title={t("detailsTitle")} />
      <p className="mt-4 flex flex-wrap items-center gap-2">
        <ListingStatusChip
          status={listing.status}
          label={statuses(listing.status)}
        />
        <span className="text-ink-muted">
          {t("since", {
            date: format.dateTime(listing.statusChangedAt, "long"),
          })}
        </span>
      </p>
      {listing.statusReason ? (
        <p className="mt-3 text-ink wrap-anywhere">
          {t("reasonLine", { reason: listing.statusReason })}
        </p>
      ) : null}
      <div className="mt-5">
        <DetailList
          items={[
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
      <div className="mt-6 flex flex-wrap gap-3">
        {listing.canEdit ? (
          <ButtonLink href={editListingPath(listing.id)}>
            {t("edit")}
          </ButtonLink>
        ) : null}
        {listing.status === "verified" ? (
          <ButtonLink
            href={publicListingPath(listing.slug)}
            variant="secondary"
          >
            {t("publicPage")}
          </ButtonLink>
        ) : null}
      </div>
    </section>
  );
}

async function Documents({ listing }: { listing: MyListing }) {
  const [t, kinds, fileStatuses, callout, format] = await Promise.all([
    getTranslations("directory.listing"),
    getTranslations("directory.documentKind"),
    getTranslations("directory.fileStatus"),
    getTranslations("common.callout"),
    getFormatter(),
  ]);
  const labels: DocumentUploadLabels = {
    kind: t("documents.kind"),
    kinds: Object.fromEntries(
      DOCUMENT_KINDS.map((kind) => [kind, kinds(kind)])
    ) as DocumentUploadLabels["kinds"],
    file: t("documents.file"),
    limits: t("documents.limits"),
    submit: t("documents.submit"),
    uploading: t("documents.uploading"),
    uploaded: t("uploaded"),
    errors: {
      empty: t("documents.errors.empty"),
      invalid_input: t("documents.errors.invalid_input"),
      type_not_allowed: t("documents.errors.type_not_allowed"),
      too_large: t("documents.errors.too_large"),
      purpose_unavailable: t("documents.errors.purpose_unavailable"),
      listing_not_editable: t("documents.errors.listing_not_editable"),
      too_many_documents: t("documents.errors.too_many_documents"),
      upload_failed: t("documents.errors.upload_failed"),
      forbidden: t("documents.errors.forbidden"),
      not_found: t("documents.errors.not_found"),
      upload_missing: t("documents.errors.upload_missing"),
      size_mismatch: t("documents.errors.size_mismatch"),
      type_mismatch: t("documents.errors.type_mismatch"),
      upload_expired: t("documents.errors.upload_expired"),
      unexpected: t("documents.errors.unexpected"),
    },
    problem: callout("danger"),
    done: callout("success"),
  };
  return (
    <section aria-labelledby="listing-documents" className={CARD}>
      <SectionHeading id="listing-documents" title={t("documents.title")} />
      <p className="mt-3 text-ink">{t("documents.lead")}</p>
      {listing.documents.length === 0 ? (
        <p className="mt-4 text-ink-muted">{t("documents.empty")}</p>
      ) : (
        <div className="mt-4">
          <TableScroller captionId="documents-caption">
            <table className="w-full min-w-[28rem] border-collapse text-body">
              <caption id="documents-caption" className="sr-only">
                {t("documents.caption")}
              </caption>
              <thead className="border-b-2 border-border bg-surface-muted">
                <tr>
                  <th scope="col" className={CELL}>
                    {t("documents.column.kind")}
                  </th>
                  <th scope="col" className={CELL}>
                    {t("documents.column.status")}
                  </th>
                  <th scope="col" className={CELL}>
                    {t("documents.column.uploaded")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {listing.documents.map((document) => (
                  <tr
                    key={document.id}
                    className="border-b border-border last:border-b-0"
                  >
                    <th scope="row" className={CELL}>
                      {kinds(document.kind)}
                    </th>
                    <td className={CELL}>
                      {fileStatuses(document.fileStatus)}
                    </td>
                    <td className={`${CELL} whitespace-nowrap`}>
                      {format.dateTime(document.uploadedAt, "long")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        </div>
      )}
      <div className="mt-6">
        {listing.canAddDocuments ? (
          <DocumentUpload listingId={listing.id} labels={labels} />
        ) : (
          <p className="text-ink-muted">{t("documents.closed")}</p>
        )}
      </div>
    </section>
  );
}

/** Where its representatives list animals for adoption (#129). */
async function AdoptionsLink({ listingId }: { listingId: string }) {
  const t = await getTranslations("adoption.organisationLink");
  return (
    <section aria-labelledby="adoptions-title" className={CARD}>
      <SectionHeading id="adoptions-title" title={t("title")} />
      <p className="mt-3 text-ink">{t("body")}</p>
      <div className="mt-5">
        <ButtonLink href={adoptionsPath(listingId)} variant="secondary">
          {t("link")}
        </ButtonLink>
      </div>
    </section>
  );
}
