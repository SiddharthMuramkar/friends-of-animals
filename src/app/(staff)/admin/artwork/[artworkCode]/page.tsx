import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink } from "@/components/site/button-link";
import { buttonStyles } from "@/components/site/button-link";
import { ArtworkFacts } from "@/components/artwork/artwork-facts";
import { as, currentActor } from "@/server/app";
import { ADMIN_ARTWORK, adminArtworkPath } from "@/lib/app-routes";
import { adminCall } from "../../_lib/boundary";
import { AdminDenied } from "../../_components/admin-denied";
import { CustodyPanel } from "./custody-panel";
import { receiveArtwork } from "../_lib/actions";
// Signed-in, nonce-CSP pages read their actor and artwork at request time.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("artwork");
  return { title: t("title"), robots: { index: false, follow: false } };
}
export default async function Page({
  params,
  searchParams,
}: PageProps<"/admin/artwork/[artworkCode]">) {
  const [actor, t, { artworkCode }, query] = await Promise.all([
    currentActor(),
    getTranslations("artwork"),
    params,
    searchParams,
  ]);
  const result = await adminCall(
    () => as(actor).getArtwork({ artworkCode }),
    adminArtworkPath(artworkCode)
  );
  const work = result.ok && result.value.ok ? result.value.artwork : null;
  const custody = work
    ? await adminCall(
        () => as(actor).getArtworkCustody({ artworkId: work.artworkId }),
        adminArtworkPath(artworkCode)
      )
    : null;
  const detail = custody?.ok && custody.value.ok ? custody.value : null;
  const photoLinks = detail
    ? await Promise.all(
        detail.photos
          .filter((p) => p.selectedAt && p.status === "clean")
          .map(async (photo) => {
            const signed = await as(actor).getArtworkPhotoUrl({
              photoId: photo.id,
            });
            return signed.ok ? { id: photo.id, url: signed.url } : null;
          })
      )
    : [];

  return (
    <Section width="wide" hue="green" className="pt-10 sm:pt-14">
      <PageHeader
        title={work ? t("details", { code: work.artworkCode }) : t("title")}
      />
      <ButtonLink
        href={
          work
            ? `${ADMIN_ARTWORK}?competition=${work.competitionId}`
            : ADMIN_ARTWORK
        }
        variant="secondary"
        className="mt-4"
      >
        {t("back")}
      </ButtonLink>
      {query.result ? (
        <output className="block mt-4">
          {t(query.result === "ok" ? "success" : "failure")}
        </output>
      ) : null}
      {work ? (
        <div className="mt-6 rounded-3xl border-2 border-border bg-surface p-5">
          <ArtworkFacts work={work} />
          {work.status === "requested" || work.status === "dispatched" ? (
            <form
              action={receiveArtwork.bind(
                null,
                work.artworkId,
                work.artworkCode
              )}
              className="mt-5"
            >
              <button type="submit" className={buttonStyles()}>
                {t("receive")}
              </button>
            </form>
          ) : null}
          {detail ? (
            <CustodyPanel
              work={work}
              custody={detail}
              photoLinks={photoLinks.filter((p) => p !== null)}
            />
          ) : null}
        </div>
      ) : (
        <AdminDenied />
      )}
    </Section>
  );
}
