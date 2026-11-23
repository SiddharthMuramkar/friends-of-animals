import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { adminCmsDocumentPath, APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import type { CmsDocumentSummary } from "@/server/modules/cms";

// The site's editable documents (#111): every one, with its published
// version and whether it has unpublished changes. Content managers only;
// listCmsDocuments refuses anyone else, and so does every editor action.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCms.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  const t = await getTranslations("adminCms");
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Documents />
      </Suspense>
    </Section>
  );
}

const LINK =
  "font-semibold text-link underline decoration-1 underline-offset-2 hover:text-link-hover";

/** Every document's state; null if the actor may not edit the site. */
async function documentsFor(
  actor: Awaited<ReturnType<typeof currentActor>>
): Promise<CmsDocumentSummary[] | null> {
  try {
    return await as(actor).listCmsDocuments();
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") return null;
    throw error;
  }
}

async function Documents() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, format, documents] = await Promise.all([
    getTranslations("adminCms"),
    getFormatter(),
    documentsFor(actor),
  ]);

  if (!documents) {
    return (
      <ExplainState
        title={t("denied.title")}
        back={{ href: APP_ROUTES.accountSessions, label: t("denied.back") }}
        className="mt-8"
      >
        <p>{t("denied.body")}</p>
      </ExplainState>
    );
  }

  return (
    <TableScroller captionId="cms-documents" className="mt-8">
      <table className="w-full text-left">
        <caption id="cms-documents" className="sr-only">
          {t("list.caption")}
        </caption>
        <thead className="bg-surface-muted text-sm">
          <tr>
            <th scope="col" className="px-5 py-3">
              {t("list.page")}
            </th>
            <th scope="col" className="px-5 py-3">
              {t("list.published")}
            </th>
            <th scope="col" className="px-5 py-3">
              {t("list.draft")}
            </th>
            <th scope="col" className="px-5 py-3">
              <span className="sr-only">{t("list.edit")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => {
            const name = t(`documents.${document.key}`);
            return (
              <tr
                key={document.key}
                className="border-t border-border align-top"
              >
                <th scope="row" className="px-5 py-4 font-semibold">
                  {name}
                </th>
                <td className="px-5 py-4">
                  {document.published
                    ? t("list.version", {
                        version: document.published.version,
                        date: format.dateTime(
                          document.published.publishedAt,
                          "long"
                        ),
                      })
                    : t("list.notPublished")}
                </td>
                <td className="px-5 py-4">
                  {document.hasDraft ? t("list.hasDraft") : t("list.noDraft")}
                </td>
                <td className="px-5 py-4">
                  {document.editable ? (
                    <SiteLink
                      href={adminCmsDocumentPath(document.key)}
                      aria-label={t("list.editLabel", { document: name })}
                      className={LINK}
                    >
                      {t("list.edit")}
                    </SiteLink>
                  ) : (
                    <span className="text-ink-muted">{t("list.later")}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroller>
  );
}
