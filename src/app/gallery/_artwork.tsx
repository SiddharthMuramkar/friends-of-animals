import { SiteLink } from "@/components/site/site-link";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { buttonStyles } from "@/components/site/button-link";
import type { PublicGalleryItem } from "@/server/modules/gallery";

export async function ArtworkDetails({
  item,
  priority = false,
}: {
  item: PublicGalleryItem;
  priority?: boolean;
}) {
  const t = await getTranslations("gallery");
  return (
    <>
      <div className="mt-2 space-y-2 text-ink wrap-anywhere">
        <p className="font-semibold">
          {t("credit", { name: item.credit.name })}
        </p>
        {item.credit.school || item.credit.city ? (
          <p>
            {[item.credit.school, item.credit.city].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        <p className="text-sm">
          {item.competition.name} · {t("category", { category: item.category })}
        </p>
        {item.recognition ? (
          <p className="text-sm font-semibold">
            {t("award", {
              recognition: item.recognition.value.replaceAll("_", " "),
            })}
          </p>
        ) : null}
        {item.story ? (
          <p className="whitespace-pre-line">{item.story}</p>
        ) : null}
      </div>
      <figure className="mt-5">
        <picture>
          <source media="(max-width: 639px)" srcSet={item.image.thumbnailUrl} />
          <Image
            src={item.image.url}
            width={item.image.width}
            height={item.image.height}
            alt={t(item.image.sampleIllustration ? "aiAlt" : "artAlt", {
              title: item.title,
            })}
            unoptimized
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            className="h-auto w-full rounded-2xl border border-border"
          />
        </picture>
        {item.image.sampleIllustration ? (
          <figcaption className="mt-2 text-xs text-ink-muted">
            {t("illustration")}
          </figcaption>
        ) : null}
      </figure>
    </>
  );
}
export async function ArtworkCards({
  items,
  priority = true,
}: {
  items: PublicGalleryItem[];
  priority?: boolean;
}) {
  const t = await getTranslations("gallery");
  if (!items.length) return <p className="mt-5 text-ink-muted">{t("empty")}</p>;
  return (
    <ul className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item, index) => (
        <li
          key={item.itemId}
          className="min-w-0 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm"
        >
          <h3 className="text-h4 text-ink wrap-anywhere">{item.title}</h3>
          <ArtworkDetails item={item} priority={priority && index === 0} />
          <SiteLink
            prefetch={false}
            className={buttonStyles({
              variant: "secondary",
              className: "mt-5",
            })}
            href={`/gallery/${item.itemId}`}
          >
            {t("view", { title: item.title })}
          </SiteLink>
        </li>
      ))}
    </ul>
  );
}
