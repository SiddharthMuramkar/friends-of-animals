"use client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MediaViewer } from "@/components/media-viewer/media-viewer";
import type { BlindEntryView } from "@/server/modules/judging/blind/domain/blind-entry-view";
export function Work({ view }: { view: BlindEntryView }) {
  const router = useRouter(),
    t = useTranslations("judgeScoring");
  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-bold">{t("work")}</h2>
      {view.media.map((media, index) => (
        <MediaViewer
          key={index}
          media={media}
          entryCode={view.entryCode}
          onRefresh={() => router.refresh()}
        />
      ))}
    </div>
  );
}
