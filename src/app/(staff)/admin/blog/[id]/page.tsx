import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ArticleBodyView } from "@/app/blog/[slug]/_components/article-body";
import { SubmitButton, TextField } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { Callout } from "@/components/site/callout";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { TableScroller } from "@/components/site/table-scroller";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { PostForEdit } from "@/server/modules/cms";
import { instantToIstLocal } from "@/server/modules/competitions/domain/ist";

import { EditorNotice } from "../../cms/_components/editor-notice";
import { ImageUpload } from "../_components/image-upload";
import { PostForm } from "../_components/post-form";
import {
  archivePostAction,
  describePostImageAction,
  publishPostAction,
  restorePostAction,
  schedulePostAction,
  unschedulePostAction,
  updatePostAction,
} from "../_lib/actions";
import {
  imageUploadLabels,
  postFormLabels,
  postFormOptions,
} from "../_lib/labels";
import { noticeOf, type Notice } from "../_lib/notices";
import { postFormOf } from "../_lib/post-form";
import { previewBody } from "../_lib/preview";
import { postFor } from "../_lib/reads";

// One post's editor (#112): its fields and text, its images, publishing
// (now, at a time, back to a draft, archive, restore) and a preview of the
// saved text, rendered on the server by the blog's own article view.

type Props = PageProps<"/admin/blog/[id]">;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminBlog.meta");
  return {
    title: t("editTitle"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page({ params, searchParams }: Props) {
  const t = await getTranslations("adminBlog");
  return (
    <Section hue="neutral" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <p className="mb-6">
        <ButtonLink href={APP_ROUTES.adminBlog} variant="quiet">
          <ArrowLeft aria-hidden="true" />
          {t("edit.back")}
        </ButtonLink>
      </p>
      {/* The id and who is asking are read per request: the page streams
          in behind this boundary. */}
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Editor params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-8";

async function Editor({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, query, t, format] = await Promise.all([
    params,
    searchParams,
    getTranslations("adminBlog"),
    getFormatter(),
  ]);
  const found = await postFor(as(actor), id);

  if (!found) {
    return (
      <>
        <PageHeader eyebrow={t("eyebrow")} tile="blue" title={t("title")} />
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
  if (!found.ok) {
    return (
      <>
        <PageHeader eyebrow={t("eyebrow")} tile="blue" title={t("title")} />
        <ExplainState
          title={t("notFound.title")}
          back={{ href: APP_ROUTES.adminBlog, label: t("notFound.back") }}
          className="mt-8"
        >
          <p>{t("notFound.body")}</p>
        </ExplainState>
      </>
    );
  }

  const { post } = found;
  const date = (at: Date) => format.dateTime(at, "long");
  const notice = noticeOf(query);

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={post.title}
        className="wrap-anywhere"
      />
      <ul className="mt-5 flex flex-col gap-1 text-ink-muted">
        <li>{t("edit.status", { status: t(`statuses.${post.status}`) })}</li>
        {post.status === "scheduled" && post.publishAt ? (
          <li>{t("edit.scheduledFor", { date: date(post.publishAt) })}</li>
        ) : null}
        {post.status === "published" && post.publishedAt ? (
          <li>{t("edit.publishedOn", { date: date(post.publishedAt) })}</li>
        ) : null}
        {post.status === "archived" && post.archivedAt ? (
          <li>{t("edit.archivedOn", { date: date(post.archivedAt) })}</li>
        ) : null}
      </ul>

      {notice ? (
        <div className="mt-6">
          <NoticeOf notice={notice} />
        </div>
      ) : null}

      <div className="mt-8 flex flex-col gap-8">
        <Publishing post={post} />
        {post.status === "archived" ? null : <PostFields post={post} />}
        <Images post={post} />
        <Preview post={post} />
      </div>
    </>
  );
}

async function PostFields({ post }: { post: PostForEdit }) {
  const t = await getTranslations("adminBlog");
  const [labels, options] = await Promise.all([
    postFormLabels({ label: t("form.save"), pending: t("form.saving") }),
    postFormOptions(post.images),
  ]);
  return (
    <section aria-labelledby="post-fields" className={CARD}>
      <h2 id="post-fields" className="text-h3">
        {t("form.heading")}
      </h2>
      <div className="mt-5">
        <PostForm
          // Start again from what was saved after each save.
          key={post.updatedAt.toISOString()}
          action={updatePostAction.bind(null, post.id)}
          initial={postFormOf(post)}
          labels={labels}
          {...options}
        />
      </div>
    </section>
  );
}

async function Publishing({ post }: { post: PostForEdit }) {
  const [t, format] = await Promise.all([
    getTranslations("adminBlog.publishing"),
    getFormatter(),
  ]);
  const hidden = <input type="hidden" name="postId" value={post.id} />;
  const scheduleForm = (label: string) => (
    <form action={schedulePostAction} className="flex flex-col gap-4">
      {hidden}
      <TextField
        id="post-publish-at"
        name="publishAt"
        type="datetime-local"
        label={t("publishAt")}
        defaultValue={post.publishAt ? instantToIstLocal(post.publishAt) : ""}
        required
      />
      <div>
        <SubmitButton variant="secondary" pendingLabel={t("scheduling")}>
          {label}
        </SubmitButton>
      </div>
    </form>
  );
  const button = (
    action: (formData: FormData) => Promise<void>,
    label: string,
    pending: string,
    variant?: "secondary"
  ) => (
    <form action={action}>
      {hidden}
      <SubmitButton variant={variant} pendingLabel={pending}>
        {label}
      </SubmitButton>
    </form>
  );

  return (
    <section aria-labelledby="post-publishing" className={CARD}>
      <h2 id="post-publishing" className="text-h3">
        {t("heading")}
      </h2>
      {post.status === "draft" ? (
        <>
          <p className="mt-2 text-ink-muted">{t("draftLead")}</p>
          <div className="mt-5 flex flex-col gap-6">
            {button(publishPostAction, t("publish"), t("publishing"))}
            {scheduleForm(t("schedule"))}
          </div>
        </>
      ) : null}
      {post.status === "scheduled" && post.publishAt ? (
        <>
          <p className="mt-2 text-ink-muted">
            {t("scheduledLead", {
              date: format.dateTime(post.publishAt, "long"),
            })}
          </p>
          <div className="mt-5 flex flex-col gap-6">
            <div className="flex flex-wrap gap-3">
              {button(publishPostAction, t("publish"), t("publishing"))}
              {button(
                unschedulePostAction,
                t("unschedule"),
                t("unscheduling"),
                "secondary"
              )}
            </div>
            {scheduleForm(t("reschedule"))}
          </div>
        </>
      ) : null}
      {post.status === "published" ? (
        <>
          <p className="mt-2 text-ink-muted">{t("publishedLead")}</p>
          <div className="mt-5">
            {button(
              archivePostAction,
              t("archive"),
              t("archiving"),
              "secondary"
            )}
          </div>
        </>
      ) : null}
      {post.status === "archived" ? (
        <>
          <p className="mt-2 text-ink-muted">{t("archivedLead")}</p>
          <div className="mt-5">
            {button(restorePostAction, t("restore"), t("restoring"))}
          </div>
        </>
      ) : null}
    </section>
  );
}

async function Images({ post }: { post: PostForEdit }) {
  const [t, callout, uploadLabels] = await Promise.all([
    getTranslations("adminBlog.images"),
    getTranslations("common.callout"),
    imageUploadLabels(),
  ]);
  return (
    <section aria-labelledby="post-images" className={CARD}>
      <h2 id="post-images" className="text-h3">
        {t("heading")}
      </h2>
      <p className="mt-2 text-ink-muted">{t("lead")}</p>
      <Callout tone="warning" title={t("consentTitle")} className="mt-5">
        <p>{t("consent")}</p>
      </Callout>
      {post.images.length === 0 ? (
        <p className="mt-5 text-ink-muted">{t("none")}</p>
      ) : (
        <TableScroller captionId="post-images-caption" className="mt-5">
          <table className="w-full text-left">
            <caption id="post-images-caption" className="sr-only">
              {t("caption")}
            </caption>
            <thead className="bg-surface-muted text-sm">
              <tr>
                <th scope="col" className="px-5 py-3">
                  {t("alt")}
                </th>
                <th scope="col" className="px-5 py-3">
                  {t("id")}
                </th>
                <th scope="col" className="px-5 py-3">
                  {t("state")}
                </th>
              </tr>
            </thead>
            <tbody>
              {post.images.map((image, n) => (
                <tr key={image.id} className="border-t border-border align-top">
                  <td className="px-5 py-4">
                    <form
                      action={describePostImageAction}
                      className="flex flex-col gap-3"
                    >
                      <input type="hidden" name="postId" value={post.id} />
                      <input
                        type="hidden"
                        name="postImageId"
                        value={image.id}
                      />
                      <TextField
                        id={`post-image-alt-${n}`}
                        name="alt"
                        label={t("alt")}
                        hint={t("altHint")}
                        defaultValue={image.alt}
                      />
                      <div>
                        <SubmitButton
                          variant="secondary"
                          pendingLabel={t("describing")}
                        >
                          {t("describe")}
                        </SubmitButton>
                      </div>
                    </form>
                  </td>
                  <td className="px-5 py-4 font-mono text-sm break-all">
                    {t("directive", { id: image.id })}
                  </td>
                  <td className="px-5 py-4">
                    {image.ready ? t("ready") : t("notReady")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
      {post.status === "archived" ? null : (
        <div className="mt-6">
          <ImageUpload
            postId={post.id}
            labels={{ ...uploadLabels, problem: callout("danger") }}
          />
        </div>
      )}
    </section>
  );
}

async function Preview({ post }: { post: PostForEdit }) {
  const t = await getTranslations("adminBlog.preview");
  const body = previewBody(post.body, post.images, {
    image: t("image"),
    ready: (alt) => t("imageReady", { alt }),
    notReady: (alt) => t("imageNotReady", { alt }),
    noAlt: t("noAlt"),
  });
  return (
    <section aria-labelledby="post-preview" className={CARD}>
      <h2 id="post-preview" className="text-h3">
        {t("heading")}
      </h2>
      <p className="mt-2 text-ink-muted">{t("lead")}</p>
      <div className="mt-6 border-t-2 border-border pt-6">
        <ArticleBodyView body={body} id="post-preview-body" />
      </div>
    </section>
  );
}

/** The redirect's notice: what was done, or why not. */
async function NoticeOf({ notice }: { notice: Notice }) {
  const t = await getTranslations("adminBlog.notices");
  if (notice.refused) {
    return (
      <EditorNotice
        key={notice.key}
        tone="danger"
        label={t("problem")}
        message={t(`refused.${notice.refused}`)}
      />
    );
  }
  return (
    <EditorNotice
      key={notice.key}
      tone="success"
      label={t("done")}
      message={t(notice.kind)}
    />
  );
}
