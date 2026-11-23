import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { TableScroller } from "@/components/site/table-scroller";
import { adminBlogPostPath, APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { PostSummary } from "@/server/modules/cms";

import { postsFor } from "./_lib/reads";

// Blog posts and stories (#112): every post, in every status, the most
// recently changed first. Content managers only; listPosts refuses anyone
// else, and so does every editor action.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminBlog.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  const t = await getTranslations("adminBlog");
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
        <Posts />
      </Suspense>
    </Section>
  );
}

const LINK =
  "font-semibold text-link underline decoration-1 underline-offset-2 hover:text-link-hover";

async function Posts() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, format, posts] = await Promise.all([
    getTranslations("adminBlog"),
    getFormatter(),
    postsFor(as(actor)),
  ]);

  if (!posts) {
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

  const when = (post: PostSummary) => {
    const date = (at: Date) => format.dateTime(at, "long");
    if (post.status === "scheduled" && post.publishAt) {
      return t("list.scheduledFor", { date: date(post.publishAt) });
    }
    if (post.status === "published" && post.publishedAt) {
      return t("list.publishedOn", { date: date(post.publishedAt) });
    }
    return t("list.changedOn", { date: date(post.updatedAt) });
  };

  return (
    <div className="mt-8 flex flex-col gap-6">
      <div>
        <ButtonLink href={APP_ROUTES.adminNewBlogPost}>
          <Plus aria-hidden="true" />
          {t("list.new")}
        </ButtonLink>
      </div>
      {posts.length === 0 ? (
        <p className="text-ink-muted">{t("list.empty")}</p>
      ) : (
        <TableScroller captionId="blog-posts">
          <table className="w-full text-left">
            <caption id="blog-posts" className="sr-only">
              {t("list.caption")}
            </caption>
            <thead className="bg-surface-muted text-sm">
              <tr>
                <th scope="col" className="px-5 py-3">
                  {t("list.post")}
                </th>
                <th scope="col" className="px-5 py-3">
                  {t("list.kind")}
                </th>
                <th scope="col" className="px-5 py-3">
                  {t("list.status")}
                </th>
                <th scope="col" className="px-5 py-3">
                  {t("list.when")}
                </th>
                <th scope="col" className="px-5 py-3">
                  <span className="sr-only">{t("list.edit")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id} className="border-t border-border align-top">
                  <th
                    scope="row"
                    className="px-5 py-4 font-semibold wrap-anywhere"
                  >
                    {post.title}
                  </th>
                  <td className="px-5 py-4">{t(`kinds.${post.kind}`)}</td>
                  <td className="px-5 py-4">{t(`statuses.${post.status}`)}</td>
                  <td className="px-5 py-4">{when(post)}</td>
                  <td className="px-5 py-4">
                    <SiteLink
                      href={adminBlogPostPath(post.id)}
                      aria-label={t("list.editLabel", { title: post.title })}
                      className={LINK}
                    >
                      {t("list.edit")}
                    </SiteLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      )}
    </div>
  );
}
