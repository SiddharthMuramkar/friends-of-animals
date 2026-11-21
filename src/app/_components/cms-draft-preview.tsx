import { Eye } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { buttonStyles } from "@/components/site/button-link";

import { exitCmsPreviewAction } from "../_lib/cms-preview";

/**
 * Says a CMS-backed page is in Draft Mode (#111): whether it shows the
 * unpublished draft, and a way out. Shown only while Draft Mode is on, so
 * a content manager can't mistake a preview for the live page. A plain
 * form: it works before any script loads and adds none to the page.
 */
export async function CmsDraftPreview({
  path,
  showingDraft,
}: {
  path: `/${string}`;
  showingDraft: boolean;
}) {
  const t = await getTranslations("adminCms.preview");
  return (
    <div
      role="status"
      className="mt-5 flex max-w-3xl flex-col gap-3 rounded-2xl border-2 border-warning-border bg-warning-bg p-4 text-ink sm:flex-row sm:items-center"
    >
      <p className="flex min-w-0 flex-1 gap-3">
        <Eye aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <span className="flex flex-col">
          <strong>{t("status")}</strong>
          <span>{showingDraft ? t("draft") : t("noDraft")}</span>
        </span>
      </p>
      <form action={exitCmsPreviewAction} className="shrink-0">
        <input type="hidden" name="path" value={path} />
        <button
          type="submit"
          className={buttonStyles({ variant: "secondary", size: "md" })}
        >
          {t("exit")}
        </button>
      </form>
    </div>
  );
}
