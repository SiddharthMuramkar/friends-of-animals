import { getFormatter, getTranslations } from "next-intl/server";

import { getSampleCertificate } from "@/content/sample";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

import { H, type HeadingLevel } from "./heading";

// A QR stand-in built from the logo's tiles: three finder squares and a
// fixed scatter of small tiles. Decorative; the real QR comes with /verify.
const QR_DOTS = [
  [4, 0],
  [6, 1],
  [5, 2],
  [8, 0],
  [9, 3],
  [4, 4],
  [6, 5],
  [8, 5],
  [0, 4],
  [2, 5],
  [1, 6],
  [3, 8],
  [5, 7],
  [7, 7],
  [9, 6],
  [6, 9],
  [8, 9],
  [4, 9],
  [9, 8],
  [7, 4],
] as const;

function QrTile() {
  return (
    <svg aria-hidden="true" viewBox="0 0 10 10" className="size-20 sm:size-24">
      <rect x="0" y="0" width="3" height="3" rx="0.66" fill="#C92827" />
      <rect x="7" y="0" width="3" height="3" rx="0.66" fill="#07AC06" />
      <rect x="0" y="7" width="3" height="3" rx="0.66" fill="#2B41F0" />
      {QR_DOTS.map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="0.9"
          height="0.9"
          rx="0.2"
          fill="#25221E"
        />
      ))}
    </svg>
  );
}

const CORNER_TILE = "absolute size-5 rounded-[22%] sm:size-7";

/**
 * "A certificate for everyone": a full-size sample participation
 * certificate, watermarked SAMPLE, with a certificate number in the real
 * format and a QR placeholder. Printed on paper in both themes. In
 * production, where sample content is off, the name, competition and other
 * details are neutral placeholder text ("Your name").
 */
export async function CertificatePreview({
  headingLevel = 2,
  intro = true,
  className,
}: {
  headingLevel?: HeadingLevel;
  /** Title and lead above the certificate. */
  intro?: boolean;
  className?: string;
}) {
  const t = await getTranslations("showcase.certificate");
  const ts = await getTranslations("sample");
  const format = await getFormatter();
  const c = getSampleCertificate();

  return (
    <div className={className}>
      {intro ? (
        <>
          <H
            level={headingLevel}
            className="text-(--section-heading,var(--ink))"
          >
            {t("title")}
          </H>
          <p className="mt-4 max-w-prose text-lead text-ink-muted">
            {t("lead")}
          </p>
        </>
      ) : null}

      <figure className={cn("mx-auto max-w-3xl", intro && "mt-8")}>
        <div className="relative isolate overflow-hidden rounded-3xl bg-[#FFFDF8] p-3 text-[#25221E] shadow-warm ring-1 ring-black/10 sm:p-4">
          <div className="relative flex flex-col rounded-2xl border-2 border-[#E3DCCF] px-5 py-8 text-center sm:aspect-[1.414/1] sm:px-12 sm:py-10">
            <span
              aria-hidden="true"
              className={cn(CORNER_TILE, "top-3 left-3 bg-[#C92827]")}
            />
            <span
              aria-hidden="true"
              className={cn(CORNER_TILE, "top-3 right-3 bg-[#07AC06]")}
            />
            <span
              aria-hidden="true"
              className={cn(CORNER_TILE, "bottom-3 left-3 bg-[#2B41F0]")}
            />

            {/* oxlint-disable-next-line nextjs/no-img-element -- registered SVG logo, used as-is */}
            <img
              src={SITE.logo.src}
              alt={SITE.name}
              width={SITE.logo.width}
              height={SITE.logo.height}
              className="mx-auto h-12 w-auto sm:h-16"
            />
            <p className="mt-4 font-display text-h3 leading-tight font-bold">
              {t("heading")}
            </p>
            <p className="mt-3 text-sm sm:text-body">{t("certify")}</p>
            <p className="mt-1 font-hand text-h2 leading-tight text-[#2134B9]">
              {c ? ts("certificate.name") : t("placeholder.name")}
            </p>
            <p className="text-sm sm:text-body">{t("tookPart")}</p>
            <p className="mt-1 font-display text-h4 leading-tight font-bold">
              {c ? c.competition.name : t("placeholder.competition")}
            </p>
            <p className="mt-1 text-sm">
              {c
                ? t("category", {
                    discipline: ts(`discipline.${c.discipline}`),
                    group: ts("certificate.group"),
                    min: c.ageGroup.minAge,
                    max: c.ageGroup.maxAge,
                  })
                : t("placeholder.category")}
            </p>

            <div className="mt-6 flex flex-col items-center gap-4 text-left sm:mt-auto sm:flex-row sm:items-end sm:justify-between sm:pt-6">
              <div className="text-sm">
                <p>
                  {c
                    ? t("issued", {
                        date: format.dateTime(
                          new Date(`${c.issuedOn}T12:00:00+05:30`),
                          "long"
                        ),
                      })
                    : t("placeholder.issued")}
                </p>
                <p className="mt-2 text-xs font-semibold tracking-wide uppercase">
                  {t("number")}
                </p>
                <p className="font-mono text-sm font-semibold sm:text-base">
                  {c ? c.number : t("placeholder.number")}
                </p>
              </div>
              <div className="flex flex-col items-center gap-1">
                <QrTile />
                <span className="text-xs">{t("qr")}</span>
              </div>
            </div>

            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 grid place-items-center"
            >
              {/* SVG text: a watermark, not content (and not checked for contrast). */}
              <svg
                viewBox="0 0 420 130"
                className="w-[85%] max-w-xl -rotate-[18deg] overflow-visible"
              >
                <rect
                  x="4"
                  y="4"
                  width="412"
                  height="122"
                  rx="26"
                  fill="none"
                  stroke="#C92827"
                  strokeOpacity="0.3"
                  strokeWidth="6"
                />
                <text
                  x="210"
                  y="100"
                  textAnchor="middle"
                  fill="#C92827"
                  fillOpacity="0.2"
                  fontSize="96"
                  fontWeight="700"
                  letterSpacing="12"
                  className="font-display uppercase"
                >
                  {t("watermark")}
                </text>
              </svg>
            </span>
          </div>
        </div>
        <figcaption className="mt-4 flex flex-col gap-1 text-sm text-ink-muted sm:flex-row sm:justify-between sm:gap-6">
          <span className="font-semibold text-ink">{t("figureLabel")}</span>
          <span>{t("verify")}</span>
        </figcaption>
        <p className="mt-2 text-sm text-ink-muted">{t("nameNote")}</p>
      </figure>
    </div>
  );
}
