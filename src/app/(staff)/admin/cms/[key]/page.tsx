import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { SubmitButton } from "@/components/form";
import {
  LegalSectionsText,
  LegalShortList,
} from "@/components/legal/legal-text";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import type {
  CmsDraftPreview,
  CmsRevisionSummary,
  PublishedCmsDocument,
} from "@/server/modules/cms";
import {
  cmsDocumentKind,
  isCmsDocumentKey,
  type CmsDocumentKey,
} from "@/server/modules/cms/domain/documents";
import { legalKind } from "@/server/modules/cms/kinds/legal";
import { formatConsentDocumentSource } from "@/server/modules/consent/domain/document-source";

import { EditorNotice } from "../_components/editor-notice";
import { LegalEditor } from "../_components/legal-editor";
import { publishRevisionAction, startPreviewAction } from "../_lib/actions";
import { noticeOf, type EditorNotice as Notice } from "../_lib/editor-state";

// One CMS document's editor (#111). A legal page is edited in #64's
// plain-text markup: Save keeps it as the draft, which this page shows as
// it will read; Preview opens the public page in Draft Mode; Publish makes
// the draft the next version. Kinds without an editor yet (111b's) say so.

type Props = PageProps<"/admin/cms/[key]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ key }, t] = await Promise.all([params, getTranslations("adminCms")]);
  return {
    title: isCmsDocumentKey(key)
      ? `${t(`documents.${key}`)} · ${t("meta.title")}`
      : t("meta.title"),
    description: t("meta.description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("adminCms");
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Editor params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-8";

const LINK =
  "font-semibold text-link underline decoration-1 underline-offset-2 hover:text-link-hover";

type EditorData = {
  revisions: CmsRevisionSummary[];
  draft: CmsDraftPreview | null;
  published: PublishedCmsDocument | null;
};

/** What the editor shows; null if the actor may not edit the site. */
async function editorDataFor(
  actor: Awaited<ReturnType<typeof currentActor>>,
  key: CmsDocumentKey
): Promise<EditorData | null> {
  try {
    const [revisions, draft, published] = await Promise.all([
      as(actor).listRevisions({ key }),
      as(actor).getDraftForPreview({ key }),
      as(actor).getPublishedDocument({ key }),
    ]);
    return {
      revisions: revisions.ok ? revisions.revisions : [],
      draft,
      published,
    };
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") return null;
    throw error;
  }
}

async function Editor({ params, searchParams }: Props) {
  const [{ key }, query] = await Promise.all([params, searchParams]);
  if (!isCmsDocumentKey(key)) notFound();
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, format, data] = await Promise.all([
    getTranslations("adminCms"),
    getFormatter(),
    editorDataFor(actor, key),
  ]);
  const name = t(`documents.${key}`);
  const back = (
    <p className="mb-6">
      <SiteLink href={APP_ROUTES.adminCms} className={LINK}>
        {t("editor.back")}
      </SiteLink>
    </p>
  );

  if (!data) {
    return (
      <>
        <PageHeader eyebrow={t("eyebrow")} tile="blue" title={name} />
        <ExplainState
          title={t("denied.title")}
          back={{ href: APP_ROUTES.accountSessions, label: t("denied.back") }}
          className="mt-8"
        >
          <p>{t("denied.body")}</p>
        </ExplainState>
      </>
    );
  }

  if (cmsDocumentKind(key) !== "legal") {
    return (
      <>
        {back}
        <PageHeader eyebrow={t("eyebrow")} tile="blue" title={name} />
        <ExplainState
          title={t("editor.later.title")}
          back={{ href: APP_ROUTES.adminCms, label: t("editor.back") }}
          className="mt-8"
        >
          <p>{t("editor.later.body")}</p>
        </ExplainState>
      </>
    );
  }

  const { draft, published, revisions } = data;
  const date = (at: Date) => format.dateTime(at, "long");
  const notice = noticeOf(query);
  // The editor starts from the draft, else the published text, else the
  // repo's text that version 1 is seeded with.
  const source = formatConsentDocumentSource(
    draft
      ? legalKind.sanitize(draft.body)
      : published
        ? legalKind.sanitize(published.body)
        : legalKind.seedBody(key)
  );
  const draftBody = draft ? legalKind.sanitize(draft.body) : null;
  const nextVersion = (published?.version ?? 0) + 1;

  return (
    <>
      {back}
      <PageHeader eyebrow={t("eyebrow")} tile="blue" title={name} />
      <ul className="mt-5 flex flex-col gap-1 text-ink-muted">
        <li>
          {published
            ? t("editor.state.published", {
                version: published.version,
                date: date(published.publishedAt),
              })
            : t("editor.state.notPublished")}
        </li>
        <li>
          {draft
            ? t("editor.state.draft", { date: date(draft.updatedAt) })
            : t("editor.state.noDraft")}
        </li>
      </ul>

      {notice ? (
        <div className="mt-6">
          <NoticeOf notice={notice} />
        </div>
      ) : null}

      <div className="mt-8 flex flex-col gap-8">
        <section aria-labelledby="cms-edit" className={CARD}>
          <h2 id="cms-edit" className="text-h3">
            {t("editor.form.heading")}
          </h2>
          <div className="mt-5">
            <LegalEditor
              // Each save and publish comes back with a new token: start
              // the form again from what it saved, without its old errors.
              key={`${draft?.revisionId ?? "none"}:${notice?.kind === "refused" ? "" : (notice?.key ?? "")}`}
              documentKey={key}
              defaultSource={source}
              labels={{
                label: t("editor.form.label"),
                hint: t("editor.form.hint"),
                save: t("editor.form.save"),
                saving: t("editor.form.saving"),
                fixErrors: t("editor.form.fixErrors"),
                problem: t("editor.form.problem"),
              }}
            />
          </div>
        </section>

        <section aria-labelledby="cms-draft" className={CARD}>
          <h2 id="cms-draft" className="text-h3">
            {t("editor.draft.heading")}
          </h2>
          {draft && draftBody ? (
            <>
              <p className="mt-2 text-ink-muted">{t("editor.draft.lead")}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <form action={startPreviewAction}>
                  <input type="hidden" name="key" value={key} />
                  <SubmitButton
                    variant="secondary"
                    pendingLabel={t("editor.draft.previewing")}
                  >
                    {t("editor.draft.preview")}
                  </SubmitButton>
                </form>
                <form action={publishRevisionAction}>
                  <input type="hidden" name="key" value={key} />
                  <input
                    type="hidden"
                    name="revisionId"
                    value={draft.revisionId}
                  />
                  <SubmitButton pendingLabel={t("editor.draft.publishing")}>
                    {t("editor.draft.publish", { version: nextVersion })}
                  </SubmitButton>
                </form>
              </div>
              <div className="mt-8 border-t-2 border-border pt-6">
                {draftBody.short.length > 0 ? (
                  <>
                    <h3 className="text-lead font-bold text-ink">
                      {t("editor.draft.shortVersion")}
                    </h3>
                    <LegalShortList
                      points={draftBody.short}
                      className="mt-3 list-disc space-y-1 pl-5"
                    />
                  </>
                ) : null}
                <div className="mt-6">
                  <LegalSectionsText sections={draftBody.sections} level="h3" />
                </div>
              </div>
            </>
          ) : (
            <p className="mt-2 text-ink-muted">{t("editor.draft.none")}</p>
          )}
        </section>

        {revisions.length > 0 ? (
          <section aria-labelledby="cms-revisions">
            <h2 id="cms-revisions" className="text-h3">
              {t("editor.revisions.heading")}
            </h2>
            <TableScroller captionId="cms-revisions-caption" className="mt-4">
              <table className="w-full text-left">
                <caption id="cms-revisions-caption" className="sr-only">
                  {t("editor.revisions.caption")}
                </caption>
                <thead className="bg-surface-muted text-sm">
                  <tr>
                    <th scope="col" className="px-5 py-3">
                      {t("editor.revisions.version")}
                    </th>
                    <th scope="col" className="px-5 py-3">
                      {t("editor.revisions.status")}
                    </th>
                    <th scope="col" className="px-5 py-3">
                      {t("editor.revisions.date")}
                    </th>
                    <th scope="col" className="px-5 py-3">
                      {t("editor.revisions.by")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {revisions.map((revision) => (
                    <tr
                      key={revision.id}
                      className="border-t border-border align-top"
                    >
                      <th scope="row" className="px-5 py-4 font-semibold">
                        {revision.version ?? t("editor.revisions.draftVersion")}
                      </th>
                      <td className="px-5 py-4">
                        {t(`editor.revisions.statuses.${revision.status}`)}
                      </td>
                      <td className="px-5 py-4">
                        {revision.publishedAt
                          ? t("editor.revisions.publishedOn", {
                              date: date(revision.publishedAt),
                            })
                          : t("editor.revisions.savedOn", {
                              date: date(revision.updatedAt),
                            })}
                      </td>
                      <td className="px-5 py-4">
                        {(revision.publishedBy ?? revision.createdBy)?.name ??
                          t("editor.revisions.seed")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroller>
          </section>
        ) : null}
      </div>
    </>
  );
}

/** The redirect's notice: what was saved or published, or why not. */
async function NoticeOf({ notice }: { notice: Notice }) {
  const t = await getTranslations("adminCms.editor.notices");
  if (notice.kind === "refused") {
    return (
      <EditorNotice
        key={notice.reason}
        tone="danger"
        label={t("problem")}
        message={t(notice.reason)}
      />
    );
  }
  return (
    <EditorNotice
      key={notice.key}
      tone="success"
      label={t("done")}
      message={
        notice.kind === "saved"
          ? t("saved")
          : t("published", { version: notice.version })
      }
    />
  );
}
