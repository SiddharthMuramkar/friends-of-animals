import { getTranslations } from "next-intl/server";
import { cacheLife } from "next/cache";

import { LivingIllustration } from "@/components/art/living-illustration";
import { Logo } from "@/components/logo";
import { SiteLink } from "@/components/site/site-link";
import { TileDivider } from "@/components/site/tile";
import { FOOTER_GROUPS, footerRoutes, ROUTES } from "@/lib/routes";
import { isSampleContentEnabled } from "@/lib/site";

// Reading the clock during prerendering needs a cache boundary under Cache
// Components; the year is refreshed daily.
async function currentYear() {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}

const LINK =
  "inline-flex min-h-6 max-w-full items-center py-1 wrap-break-word text-ink-muted underline-offset-4 hover:text-ink hover:underline";

export async function SiteFooter() {
  const t = await getTranslations("footer");
  const tn = await getTranslations("nav");
  const year = await currentYear();

  return (
    <footer className="mt-auto border-t border-border bg-surface-muted">
      <div className="mx-auto max-w-7xl px-4 pt-12 pb-8 sm:px-6">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="max-w-md">
            <SiteLink
              href="/"
              aria-label={tn("homeLink")}
              className="inline-block rounded-xl"
            >
              <Logo className="h-14 w-auto" />
            </SiteLink>
            <p className="mt-4 text-ink-muted">{t("about")}</p>

            <section
              aria-labelledby="footer-helplines"
              className="mt-8 rounded-3xl border-2 border-border-strong bg-surface p-5 wrap-break-word"
            >
              <h2 id="footer-helplines" className="text-h4">
                {t("helplines.title")}
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                {t("helplines.intro")}
              </p>
              <ul className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2">
                <li>
                  <a
                    href="tel:112"
                    className="flex min-h-11 flex-col rounded-2xl px-3 py-2 hover:bg-surface-muted"
                  >
                    <span className="font-display text-h4 font-bold">
                      {t("helplines.emergencyNumber")}
                    </span>
                    <span className="text-sm text-ink-muted">
                      {t("helplines.emergency")}
                    </span>
                  </a>
                </li>
                <li>
                  <a
                    href="tel:1098"
                    className="flex min-h-11 flex-col rounded-2xl px-3 py-2 hover:bg-surface-muted"
                  >
                    <span className="font-display text-h4 font-bold">
                      {t("helplines.childlineNumber")}
                    </span>
                    <span className="text-sm text-ink-muted">
                      {t("helplines.childline")}
                    </span>
                  </a>
                </li>
                <li className="flex flex-col rounded-2xl px-3 py-2">
                  <a
                    href="tel:1930"
                    className="font-display text-h4 font-bold hover:underline"
                  >
                    {t("helplines.cyberNumber")}
                  </a>
                  <span className="text-sm text-ink-muted">
                    {t("helplines.cyber")} {t("helplines.cyberOr")}{" "}
                    <a
                      href="https://cybercrime.gov.in"
                      className="wrap-anywhere text-link underline underline-offset-2"
                    >
                      {t("helplines.cyberSite")}
                    </a>
                  </span>
                </li>
              </ul>
              <SiteLink
                href={ROUTES.safeguarding.path}
                className="mt-3 inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-4 hover:text-link-hover"
              >
                {t("helplines.safeguarding")}
              </SiteLink>
            </section>
          </div>

          <nav
            aria-label={t("navLabel")}
            className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-8"
          >
            {FOOTER_GROUPS.map((group) => (
              <div key={group}>
                <h2 className="font-sans text-h5 font-bold">
                  {t(`groups.${group}`)}
                </h2>
                <ul className="mt-3 space-y-1">
                  {footerRoutes(group).map((route) => (
                    <li key={route.id}>
                      <SiteLink href={route.path} className={LINK}>
                        {tn(`links.${route.id}`)}
                      </SiteLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* The street cat naps on the divider and wakes as the footer comes
            into view. It sits to the right, where the links leave room; at
            tablet widths (sm to lg) the link columns fill the row, so it
            stays away. Sized in px, so enlarged text, which grows the links,
            never grows it into them; it never takes a click either. The
            wrapper hides it: a display utility on the drawing itself would
            lose to its own display: block. It stays away from /safeguarding
            too (globals.css, data-footer-cat): no play beside the
            helplines. */}
        <div className="relative mt-12">
          <div data-footer-cat className="sm:hidden lg:block">
            <LivingIllustration
              id="living-cat"
              trigger="arrive"
              className="pointer-events-none absolute right-1 bottom-1/2 w-[80px] translate-y-[3px] sm:right-4 sm:w-[96px]"
            />
          </div>
          <TileDivider />
        </div>

        <div className="mt-6 flex flex-col gap-2 text-sm text-ink-muted sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p>{t("copyright", { year })}</p>
            <p>{t("artNote")}</p>
          </div>
          {isSampleContentEnabled() ? (
            <p className="max-w-xl sm:text-right">{t("sampleNote")}</p>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
