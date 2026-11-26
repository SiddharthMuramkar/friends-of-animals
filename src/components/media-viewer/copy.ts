import type { useTranslations } from "next-intl";

// Translate at the calling boundary. The small generic viewer itself does
// not bring the next-intl client runtime into public/styleguide pages.
export function viewerCopy(
  t: ReturnType<typeof useTranslations<"judgeScoring">>,
  entryCode: string
) {
  return {
    workAlt: t("workAlt", { entryCode }),
    videoLabel: t("videoLabel", { entryCode }),
    fullScreen: t("fullScreen"),
    viewTitle: t("viewTitle"),
    closeViewer: t("closeViewer"),
    zoomIn: t("zoomIn"),
    zoomOut: t("zoomOut"),
    fit: t("fit"),
    zoomHelp: t("zoomHelp"),
    zoomValue: t("zoomValue", { percent: "{percent}" }),
    essay: t("essay"),
    pdf: t("pdf"),
    unavailable: t("unavailable"),
    refreshWork: t("refreshWork"),
    mediaFailed: t("mediaFailed"),
  };
}
export type ViewerCopy = ReturnType<typeof viewerCopy>;
