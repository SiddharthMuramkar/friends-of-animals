import "server-only";

import { getTranslations } from "next-intl/server";

import { SITE_IMAGE_IDS } from "@/lib/images/credits";
import type { PostImageSummary } from "@/server/modules/cms";
import {
  POST_AUDIENCES,
  POST_KINDS,
} from "@/server/modules/cms/domain/post-kinds";

import type { PostFormLabels } from "../_components/post-form";
import type { ImageUploadLabels } from "../_components/image-upload";

// The post editor's words, from messages/en-IN/adminBlog.json, for its
// client components, which can't read messages themselves.

type Option = { value: string; label: string };

export async function postFormLabels(submit: {
  label: string;
  pending: string;
}): Promise<PostFormLabels> {
  const [t, callout] = await Promise.all([
    getTranslations("adminBlog.form"),
    getTranslations("common.callout"),
  ]);
  // next-intl types raw() for leaf keys only; these are whole groups.
  const subtree = (key: "errors" | "alerts" | "sourceErrors") =>
    (t.raw as (key: string) => Record<string, string>)(key);
  return {
    kind: t("kind"),
    title: t("title"),
    slug: t("slug"),
    slugHint: t("slugHint"),
    excerpt: t("excerpt"),
    excerptHint: t("excerptHint"),
    seoTitle: t("seoTitle"),
    seoTitleHint: t("seoTitleHint"),
    easyRead: t("easyRead"),
    easyReadHint: t("easyReadHint"),
    authorName: t("authorName"),
    authorNameHint: t("authorNameHint"),
    audience: t("audience"),
    topics: t("topics"),
    topicsHint: t("topicsHint"),
    featured: t("featured"),
    cover: t("cover"),
    coverHint: t("coverHint"),
    source: t("source"),
    sourceHint: t("sourceHint"),
    submit: submit.label,
    pending: submit.pending,
    fixErrors: t("fixErrors"),
    problem: callout("danger"),
    lineError: t.raw("lineError") as string,
    // Plain words with no placeholders, by code.
    errors: subtree("errors"),
    alerts: subtree("alerts"),
    sourceErrors: subtree("sourceErrors"),
  };
}

/** The kinds, audiences and covers the form offers. */
export async function postFormOptions(images: PostImageSummary[]): Promise<{
  kinds: Option[];
  audiences: Option[];
  covers: Option[];
}> {
  const t = await getTranslations("adminBlog");
  return {
    kinds: POST_KINDS.map((kind) => ({
      value: kind,
      label: t(`kinds.${kind}`),
    })),
    audiences: POST_AUDIENCES.map((audience) => ({
      value: audience,
      label: t(`audiences.${audience}`),
    })),
    covers: [
      { value: "", label: t("form.coverNone") },
      ...images.map((image) => ({
        value: `post:${image.id}`,
        label: image.alt
          ? t("form.coverUploaded", { alt: image.alt })
          : t("form.coverUploadedNoAlt"),
      })),
      ...SITE_IMAGE_IDS.map((id) => ({
        value: `site:${id}`,
        label: t("form.coverSite", { id }),
      })),
    ],
  };
}

export async function imageUploadLabels(): Promise<ImageUploadLabels> {
  const [t, callout] = await Promise.all([
    getTranslations("adminBlog.images.upload"),
    getTranslations("common.callout"),
  ]);
  return {
    label: t("label"),
    hint: t("hint"),
    submit: t("submit"),
    uploading: t("uploading"),
    checking: t("checking"),
    ready: t("ready"),
    slow: t("slow"),
    problem: callout("danger"),
    errors: {
      noFile: t("errors.noFile"),
      signedOut: t("errors.signedOut"),
      tooLarge: t("errors.tooLarge"),
      empty: t("errors.empty"),
      typeNotAllowed: t("errors.typeNotAllowed"),
      switchedOff: t("errors.switchedOff"),
      uploadFailed: t("errors.uploadFailed"),
      uploadRejected: t("errors.uploadRejected"),
      blocked: t("errors.blocked"),
      unknown: t("errors.unknown"),
    },
  };
}
