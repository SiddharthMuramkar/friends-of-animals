import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { adminArtworkPath, adminArtworkVerifyPath } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import {
  CHECKLIST_ITEMS,
  ARTWORK_CONDITIONS,
} from "@/server/modules/physical-artwork/domain/custody";
import { adminCall } from "../../../_lib/boundary";
import { AdminDenied } from "../../../_components/admin-denied";
import { verifyArtworkAction } from "../../_lib/custody-actions";
import { PhotoUpload } from "./photo-upload";

export const instant = false;
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("artworkCustody");
  return { title: t("verifyTitle"), robots: { index: false, follow: false } };
}
const field =
  "block w-full min-h-12 rounded-xl border-2 border-border-strong bg-surface p-2 text-ink";

export default async function Page({
  params,
  searchParams,
}: PageProps<"/admin/artwork/[artworkCode]/verify">) {
  const [{ artworkCode }, query, actor, t] = await Promise.all([
    params,
    searchParams,
    currentActor(),
    getTranslations("artworkCustody"),
  ]);
  const app = as(actor);
  const path = adminArtworkVerifyPath(artworkCode);
  const result = await adminCall(async () => {
    const work = await app.getArtwork({ artworkCode });
    if (!work.ok) return null;
    const custody = await app.getArtworkCustody({
      artworkId: work.artwork.artworkId,
    });
    if (!custody.ok || !custody.mayVerify || custody.status !== "received")
      return null;
    const photos = await Promise.all(
      custody.photos.map(async (photo) => ({
        ...photo,
        link:
          photo.status === "clean"
            ? await app.getArtworkPhotoUrl({ photoId: photo.id })
            : null,
      }))
    );
    return { work: work.artwork, custody, photos };
  }, path);
  const data = result.ok ? result.value : null;
  const errorCode = typeof query.result === "string" ? query.result : null;
  const errorMessage =
    errorCode === "photos_too_few" ||
    errorCode === "photo_front_and_back_required" ||
    errorCode === "photo_not_ready" ||
    errorCode === "invalid_photo" ||
    errorCode === "checklist_failed" ||
    errorCode === "condition_notes_required" ||
    errorCode === "discrepancy_open"
      ? t(`errors.${errorCode}`)
      : t("error");

  return (
    <Section width="wide" hue="green" className="pt-10 sm:pt-14">
      <PageHeader title={t("verifyTitle")} lead={t("verificationLead")} />
      <ButtonLink
        className="mt-4"
        variant="secondary"
        href={adminArtworkPath(artworkCode)}
      >
        {t("back")}
      </ButtonLink>
      {!data ? (
        <AdminDenied />
      ) : (
        <>
          <h2 className="mt-6 text-h3">
            {data.work.artworkCode} · {data.work.entryTitle}
          </h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section className="rounded-3xl border-2 border-border bg-surface p-5">
              <h3 className="text-h4">{t("digital")}</h3>
              <p>
                {data.work.entryCode} · {t("creator")}:{" "}
                {data.custody.creator?.name ?? t("unknown")}{" "}
                {data.custody.creator?.code}
              </p>
              {data.custody.picture ? (
                // The original is never served; the file module signs its display copy.
                // oxlint-disable-next-line nextjs/no-img-element -- private signed derivative
                <img
                  src={data.custody.picture.url}
                  width={data.custody.picture.width}
                  height={data.custody.picture.height}
                  referrerPolicy="no-referrer"
                  alt={data.work.entryTitle}
                  className="mt-4 w-full rounded-xl object-contain"
                />
              ) : (
                <p className="mt-3">{t("noPreview")}</p>
              )}
            </section>
            <section className="rounded-3xl border-2 border-border bg-surface p-5">
              <h3 className="text-h4">{t("photos")}</h3>
              <p className="mt-2 mb-4">{t("photoHelp")}</p>
              <PhotoUpload artworkId={data.work.artworkId} code={artworkCode} />
              <ButtonLink className="mt-4" href={path} variant="secondary">
                {t("refresh")}
              </ButtonLink>
            </section>
          </div>
          <form
            aria-label={t("verifyTitle")}
            action={verifyArtworkAction.bind(
              null,
              data.work.artworkId,
              artworkCode
            )}
            className="mt-6 space-y-5 rounded-3xl border-2 border-border bg-surface p-5"
          >
            {errorCode ? <p role="alert">{errorMessage}</p> : null}
            <fieldset className="space-y-2">
              <legend className="text-h4">{t("photos")}</legend>
              {data.photos.map((photo, index) => (
                <div
                  key={photo.id}
                  className="space-y-2 rounded-xl border border-border p-3"
                >
                  <label className="flex min-h-11 gap-2 items-center">
                    <input
                      type="checkbox"
                      name="photo"
                      value={`${photo.fileId}:${photo.kind}`}
                      defaultChecked={photo.status === "clean"}
                      disabled={photo.status !== "clean"}
                    />{" "}
                    {t("photoSelect", {
                      kind: t(`photoKinds.${photo.kind}`),
                      number: index + 1,
                    })}{" "}
                    · {t(`photoStatus.${photo.status}`)}
                  </label>
                  {photo.link?.ok ? (
                    <a
                      className="text-link underline"
                      href={photo.link.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("viewPhoto", {
                        kind: t(`photoKinds.${photo.kind}`),
                        number: index + 1,
                      })}
                    </a>
                  ) : null}
                </div>
              ))}
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-h4">{t("checklist")}</legend>
              {CHECKLIST_ITEMS.map((item) => (
                <label className="flex items-center min-h-11 gap-2" key={item}>
                  <input type="checkbox" name={item} required />
                  {t(`checklistItems.${item}`)}
                </label>
              ))}
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-h4">{t("condition")}</legend>
              {ARTWORK_CONDITIONS.map((condition) => (
                <label
                  key={condition}
                  className="flex items-center min-h-11 gap-2"
                >
                  <input
                    type="radio"
                    required
                    name="condition"
                    value={condition}
                  />
                  {t(`conditions.${condition}`)}
                </label>
              ))}
            </fieldset>
            <label className="block" htmlFor="condition-notes">
              {t("conditionNotes")}
            </label>
            <textarea
              className={field}
              id="condition-notes"
              name="conditionNotes"
              maxLength={1000}
              rows={3}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ["widthMm", "width"],
                  ["heightMm", "height"],
                  ["depthMm", "depth"],
                ] as const
              ).map(([name, label]) => (
                <div key={name}>
                  <label htmlFor={name}>{t(label)}</label>
                  <input
                    className={field}
                    id={name}
                    name={name}
                    type="number"
                    min={1}
                    max={10000}
                    required={name !== "depthMm"}
                  />
                </div>
              ))}
            </div>
            <label htmlFor="material" className="block">
              {t("material")}
            </label>
            <input
              id="material"
              name="material"
              className={field}
              required
              maxLength={120}
            />
            <label htmlFor="storage-location" className="block">
              {t("location")}
            </label>
            <input
              id="storage-location"
              name="storageLocation"
              className={field}
              required
              maxLength={120}
            />
            <button type="submit" className={buttonStyles()}>
              {t("verify")}
            </button>
          </form>
        </>
      )}
    </Section>
  );
}
