import type { PublicPhoto } from "@/server/modules/adoption";
import { cn } from "@/lib/utils";

/**
 * An adoption photo's resized copies (#129), served same-origin by
 * /media/adoption/<photoId>/<kind>. Already WebP with the metadata
 * stripped, so a plain <img> with a srcset picks the size; next/image
 * would only resize them again.
 */
export function AdoptionPhoto({
  photo,
  sizes,
  eager = false,
  className,
}: {
  photo: PublicPhoto;
  sizes: string;
  /** Only for the page's one above-the-fold photo. */
  eager?: boolean;
  className?: string;
}) {
  const largest = photo.variants.at(-1);
  const smallest = photo.variants[0];
  if (!largest || !smallest) return null;
  return (
    // oxlint-disable-next-line nextjs/no-img-element -- already resized copies
    <img
      src={smallest.url}
      srcSet={photo.variants.map((v) => `${v.url} ${v.width}w`).join(", ")}
      sizes={sizes}
      width={largest.width}
      height={largest.height}
      alt={photo.alt}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      decoding="async"
      className={cn("h-auto w-full object-cover", className)}
    />
  );
}

/** The age as words, from the parts an adoption read model carries. */
export function ageWords(
  age: { years: number; months: number },
  t: (
    key: "years" | "months" | "underMonth",
    values?: Record<string, number>
  ) => string
): string {
  const parts = [
    age.years > 0 ? t("years", { years: age.years }) : "",
    age.months > 0 ? t("months", { months: age.months }) : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : t("underMonth");
}
