import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { PostForm } from "../_components/post-form";
import { createPostAction } from "../_lib/actions";
import { postFormLabels, postFormOptions } from "../_lib/labels";
import { emptyPostForm } from "../_lib/post-form";
import { postsFor } from "../_lib/reads";

// A new blog post or story (#112): saved as a draft, then edited, given
// images and published from its own editor page.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminBlog.meta");
  return {
    title: t("newTitle"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  const t = await getTranslations("adminBlog");
  return (
    <Section hue="neutral" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <p className="mb-6">
        <ButtonLink href={APP_ROUTES.adminBlog} variant="quiet">
          <ArrowLeft aria-hidden="true" />
          {t("new.back")}
        </ButtonLink>
      </p>
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("new.title")}
        lead={t("new.lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <NewPost />
      </Suspense>
    </Section>
  );
}

async function NewPost() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const t = await getTranslations("adminBlog");
  // Only content managers see the form; createPost refuses anyone else.
  if ((await postsFor(as(actor))) === null) {
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
  const [labels, options] = await Promise.all([
    postFormLabels({ label: t("form.create"), pending: t("form.creating") }),
    postFormOptions([]),
  ]);
  return (
    <div className="mt-8">
      <PostForm
        action={createPostAction}
        initial={emptyPostForm()}
        labels={labels}
        {...options}
      />
    </div>
  );
}
