import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { ageWords } from "@/components/adoption/adoption-photo";
import { FormAlert } from "@/components/form";
import { inputStyles } from "@/components/form/text-field";
import { buttonStyles, ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import {
  adoptableAnimalPath,
  adoptionsPath,
  editAdoptionPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type {
  AdoptionListingForOwner,
  StoredPhoto,
} from "@/server/modules/adoption";
import { indianStateName } from "@/server/modules/adoption/domain/details";
import { ADOPTION_PHOTO_LIMITS } from "@/server/modules/adoption/domain/photos";

import { NotYours, unlessForbidden } from "../_components/forbidden";
import { PHOTO_UPLOAD_ERRORS, PhotoUpload } from "../_components/photo-upload";
import { changePhotoAction, moveAnimalAction } from "../_lib/actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adoption.manage.animal.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/organisation/[id]/adoptions/[adoptionId]">;

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("adoption.manage");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Animal params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const NOTICES = [
  "created",
  "saved",
  "unchanged",
  "published",
  "held",
  "resumed",
  "withdrawn",
  "photoRemoved",
  "photoDescribed",
] as const;

const ERRORS = [
  "invalid_transition",
  "directory_not_verified",
  "publish_blocked",
  "listing_closed",
  "last_photo",
  "alt_required",
  "alt_too_long",
  "invalid_input",
  "unexpected",
] as const;

function pick<T extends string>(list: readonly T[], value: unknown) {
  return list.find((each) => each === value);
}

async function Animal({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id, adoptionId }, query, t, status, callout] = await Promise.all([
    params,
    searchParams,
    getTranslations("adoption.manage.animal"),
    getTranslations("adoption.status"),
    getTranslations("common.callout"),
  ]);
  const result = await unlessForbidden(() =>
    as(actor).getAdoptionListingForOwner({ adoptionListingId: adoptionId })
  );
  // An animal reached through another listing's address is not this one's.
  if (!result?.ok || result.listing.directory.id !== id) return <NotYours />;
  const { listing } = result;
  const notice = pick(NOTICES, query.notice);
  const error = pick(ERRORS, query.error);

  return (
    <div className="flex flex-col gap-8">
      <ButtonLink
        href={adoptionsPath(listing.directory.id)}
        variant="quiet"
        className="-ms-5 self-start"
      >
        {(await getTranslations("adoption.manage.list"))("title", {
          name: listing.directory.name,
        })}
      </ButtonLink>
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={listing.details.name}
        className="wrap-anywhere"
      />
      <p className="-mt-4">
        <Chip tone={listing.status === "published" ? "green" : "neutral"}>
          {status(listing.status)}
        </Chip>
      </p>
      {notice ? (
        <FormAlert tone="success" label={callout("success")}>
          <p>{t(`notices.${notice}`)}</p>
        </FormAlert>
      ) : null}
      {error ? (
        <FormAlert tone="danger" label={callout("danger")}>
          <p>{t(`errors.${error}`)}</p>
        </FormAlert>
      ) : null}
      <Moves listing={listing} />
      <Photos listing={listing} />
      <Details listing={listing} />
    </div>
  );
}

function Hidden({ listing }: { listing: AdoptionListingForOwner }) {
  return (
    <>
      <input
        type="hidden"
        name="directoryListingId"
        value={listing.directory.id}
      />
      <input type="hidden" name="adoptionListingId" value={listing.id} />
    </>
  );
}

function MoveButton({
  listing,
  move,
  label,
  hint,
  primary = false,
}: {
  listing: AdoptionListingForOwner;
  move: "publish" | "hold" | "resume" | "withdraw";
  label: string;
  hint?: string;
  primary?: boolean;
}) {
  return (
    <form action={moveAnimalAction} className="flex flex-col gap-2">
      <Hidden listing={listing} />
      <input type="hidden" name="move" value={move} />
      {hint ? <p className="text-sm text-ink-muted">{hint}</p> : null}
      <div>
        <button
          type="submit"
          className={buttonStyles({
            variant: primary ? "primary" : "secondary",
          })}
        >
          {label}
        </button>
      </div>
    </form>
  );
}

async function Moves({ listing }: { listing: AdoptionListingForOwner }) {
  const [t, manage] = await Promise.all([
    getTranslations("adoption.manage.animal"),
    getTranslations("adoption.manage"),
  ]);
  const { moves } = listing;
  const isPublic =
    listing.directory.verified &&
    (listing.status === "published" ||
      listing.status === "on_hold" ||
      listing.status === "adopted");
  return (
    <section aria-labelledby="moves-title" className={CARD}>
      <SectionHeading id="moves-title" title={t("movesTitle")} />
      <div className="mt-4 flex flex-col gap-5">
        {!listing.directory.verified ? (
          <p className="text-ink">{manage("notVerified")}</p>
        ) : null}
        {!listing.editable ? <p className="text-ink">{t("closed")}</p> : null}
        {moves.publish ? (
          listing.publishBlockers.length > 0 ? (
            <ul className="list-disc ps-6 text-ink">
              {listing.publishBlockers.map((blocker) => (
                <li key={blocker}>{t(`blockers.${blocker}`)}</li>
              ))}
            </ul>
          ) : (
            <MoveButton
              listing={listing}
              move="publish"
              label={t("publish")}
              primary
            />
          )
        ) : null}
        {moves.resume && listing.directory.verified ? (
          <MoveButton
            listing={listing}
            move="resume"
            label={t("resume")}
            primary
          />
        ) : null}
        {moves.hold ? (
          <MoveButton
            listing={listing}
            move="hold"
            label={t("hold")}
            hint={t("holdHint")}
          />
        ) : null}
        {moves.withdraw ? (
          <MoveButton
            listing={listing}
            move="withdraw"
            label={t("withdraw")}
            hint={t("withdrawHint")}
          />
        ) : null}
        {isPublic ? (
          <p>
            <ButtonLink
              href={adoptableAnimalPath(listing.slug)}
              variant="quiet"
              className="-ms-5"
            >
              {t("viewPublic")}
            </ButtonLink>
          </p>
        ) : null}
      </div>
    </section>
  );
}

async function PhotoItem({
  listing,
  photo,
}: {
  listing: AdoptionListingForOwner;
  photo: StoredPhoto;
}) {
  const t = await getTranslations("adoption.manage.animal");
  const thumb = photo.variants[0];
  const altId = `alt-${photo.id}`;
  return (
    <li className="flex flex-col gap-3 rounded-2xl border-2 border-border p-4 sm:flex-row">
      <div className="w-full shrink-0 sm:w-40">
        {thumb ? (
          // oxlint-disable-next-line nextjs/no-img-element -- a resized private copy, served to its representatives
          <img
            src={thumb.url}
            width={thumb.width}
            height={thumb.height}
            alt={photo.altText}
            loading="lazy"
            className="h-auto w-full rounded-xl"
          />
        ) : null}
        <p className="mt-2 text-sm text-ink-muted">
          {t("photoMeta", {
            position: photo.position,
            state: t(`photoState.${photo.state}`),
          })}
        </p>
      </div>
      {listing.editable ? (
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <form action={changePhotoAction} className="flex flex-col gap-2">
            <Hidden listing={listing} />
            <input type="hidden" name="photoId" value={photo.id} />
            <label htmlFor={altId} className="font-semibold text-ink">
              {(await getTranslations("adoption.manage.upload"))("alt")}
            </label>
            <input
              id={altId}
              name="altText"
              defaultValue={photo.altText}
              maxLength={ADOPTION_PHOTO_LIMITS.altTextMax}
              className={inputStyles}
            />
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                name="intent"
                value="describe"
                className={buttonStyles({ variant: "secondary" })}
              >
                {t("describe")}
              </button>
              <button
                type="submit"
                name="intent"
                value="remove"
                className={buttonStyles({ variant: "quiet" })}
              >
                {t("remove")}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <p className="text-ink wrap-anywhere">{photo.altText}</p>
      )}
    </li>
  );
}

async function Photos({ listing }: { listing: AdoptionListingForOwner }) {
  const [t, upload, callout] = await Promise.all([
    getTranslations("adoption.manage.animal"),
    getTranslations("adoption.manage.upload"),
    getTranslations("common.callout"),
  ]);
  const canAdd =
    listing.editable &&
    listing.directory.verified &&
    listing.photos.length < ADOPTION_PHOTO_LIMITS.maxPhotos;
  return (
    <section aria-labelledby="photos-title" className={CARD}>
      <SectionHeading id="photos-title" title={t("photosTitle")} />
      <p className="mt-3 text-ink">
        {t("photosLead", { max: ADOPTION_PHOTO_LIMITS.maxPhotos })}
      </p>
      {listing.photos.length === 0 ? (
        <p className="mt-4 text-ink-muted">{t("noPhotos")}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {listing.photos.map((photo) => (
            <PhotoItem key={photo.id} listing={listing} photo={photo} />
          ))}
        </ul>
      )}
      {canAdd ? (
        <div className="mt-6">
          <h3 className="mb-3 text-lead font-bold text-ink">
            {upload("title")}
          </h3>
          <PhotoUpload
            adoptionListingId={listing.id}
            labels={{
              file: upload("file"),
              limits: upload("limits"),
              alt: upload("alt"),
              altHint: upload("altHint"),
              submit: upload("submit"),
              uploading: upload("uploading"),
              uploaded: upload("uploaded"),
              errors: Object.fromEntries(
                PHOTO_UPLOAD_ERRORS.map((key) => [key, upload(`errors.${key}`)])
              ) as Record<(typeof PHOTO_UPLOAD_ERRORS)[number], string>,
              problem: callout("danger"),
              done: callout("success"),
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm font-semibold text-ink-muted">{label}</dt>
      <dd className="text-ink whitespace-pre-line wrap-anywhere">{children}</dd>
    </div>
  );
}

async function Details({ listing }: { listing: AdoptionListingForOwner }) {
  const [t, animal, species, sex, ageParts] = await Promise.all([
    getTranslations("adoption.manage.animal"),
    getTranslations("adoption.animal"),
    getTranslations("adoption.species"),
    getTranslations("adoption.sex"),
    getTranslations("adoption.ageParts"),
  ]);
  const { details } = listing;
  return (
    <section aria-labelledby="details-title" className={CARD}>
      <SectionHeading id="details-title" title={t("detailsTitle")} />
      <dl className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Row label={animal("species")}>{species(details.species)}</Row>
        <Row label={animal("sex")}>{sex(details.sex)}</Row>
        <Row label={animal("age")}>{ageWords(details.age, ageParts)}</Row>
        <Row label={animal("place")}>
          {animal("placeValue", {
            city: details.city,
            state: indianStateName(details.state),
            pinCode: details.pinCode,
          })}
        </Row>
        <Row label={animal("conditionsTitle")}>{details.conditions}</Row>
      </dl>
      {listing.editable && listing.directory.verified ? (
        <div className="mt-5">
          <ButtonLink
            href={editAdoptionPath(listing.directory.id, listing.id)}
            variant="secondary"
          >
            {t("edit")}
          </ButtonLink>
        </div>
      ) : null}
    </section>
  );
}
