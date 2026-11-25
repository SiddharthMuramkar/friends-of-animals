import { BadgeCheck, Globe, Mail, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { Chip } from "@/components/site/chip";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { publicListingPath } from "@/lib/app-routes";
import { formatPhoneNumber, type E164Phone } from "@/lib/phone";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";
import type { PublicListing } from "@/server/modules/directory";

import { PLACEHOLDER_SLUG, publicListing } from "../_lib/public-reads";

// Verified listings live in the database, which the build can't reach, so
// the build prerenders only this route's App Shell (and the placeholder).
// A listing's first visit gets the shell while its page renders; later
// visits get the cached page, which a decision or an edit refreshes
// through the listing's cache tag. src/proxy.ts answers any slug that
// isn't a verified listing with a 404 before any of this runs.

export function generateStaticParams() {
  return [{ slug: PLACEHOLDER_SLUG }];
}

export async function generateMetadata({
  params,
}: PageProps<"/ngos/[slug]">): Promise<Metadata> {
  const listing = await publicListing((await params).slug);
  if (!listing) return {};
  return pageMetadata({
    title: listing.name,
    description: listing.description.slice(0, 160),
    path: publicListingPath(listing.slug),
  });
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";
const LINK =
  "inline-flex min-h-11 items-center gap-2 font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover wrap-anywhere";

function ContactLine({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <dt className="flex items-center gap-2 font-semibold text-ink">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

async function ListingView({ listing }: { listing: PublicListing }) {
  const [t, types, services] = await Promise.all([
    getTranslations("directory.public"),
    getTranslations("directory.type"),
    getTranslations("directory.services"),
  ]);
  const { contact } = listing;
  const hasContact = Boolean(contact.phone ?? contact.email ?? contact.website);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={listing.name}
        className="wrap-anywhere"
      />
      <p className="-mt-4 flex flex-wrap items-center gap-2">
        <Chip tone="green" icon={<BadgeCheck aria-hidden="true" />}>
          {t("verified")}
        </Chip>
        <Chip>{types(listing.type)}</Chip>
      </p>

      <section aria-labelledby="listing-about" className={CARD}>
        <SectionHeading id="listing-about" title={t("aboutTitle")} />
        <p className="mt-3 text-ink whitespace-pre-line wrap-anywhere">
          {listing.description}
        </p>
        <h3 className="mt-6 text-lead font-bold text-ink">
          {t("servicesTitle")}
        </h3>
        <ul className="mt-3 flex flex-wrap gap-2">
          {listing.services.map((service) => (
            <li key={service}>
              <Chip tone="blue">{services(service)}</Chip>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="listing-contact" className={CARD}>
        <SectionHeading id="listing-contact" title={t("contactTitle")} />
        <dl className="mt-4 flex flex-col gap-3">
          <ContactLine
            icon={<MapPin aria-hidden="true" className="size-5" />}
            label={t("placeTitle")}
          >
            <span className="text-ink">
              {t("place_value", {
                city: listing.city,
                state: listing.state,
                pinCode: listing.pinCode,
              })}
            </span>
          </ContactLine>
          {contact.phone ? (
            <ContactLine
              icon={<Phone aria-hidden="true" className="size-5" />}
              label={t("phone")}
            >
              <a href={`tel:${contact.phone}`} className={LINK}>
                {formatPhoneNumber(contact.phone as E164Phone)}
              </a>
            </ContactLine>
          ) : null}
          {contact.email ? (
            <ContactLine
              icon={<Mail aria-hidden="true" className="size-5" />}
              label={t("email")}
            >
              <a href={`mailto:${contact.email}`} className={LINK}>
                {contact.email}
              </a>
            </ContactLine>
          ) : null}
          {contact.website ? (
            <ContactLine
              icon={<Globe aria-hidden="true" className="size-5" />}
              label={t("website")}
            >
              <a
                href={contact.website}
                rel="nofollow noopener noreferrer"
                className={LINK}
              >
                {new URL(contact.website).host}
              </a>
            </ContactLine>
          ) : null}
        </dl>
        {hasContact ? null : <p className="mt-4 text-ink">{t("noContact")}</p>}
      </section>

      <aside
        aria-label={t("verified")}
        className="rounded-3xl border-2 border-dashed border-border-strong bg-surface p-5 text-ink sm:p-6"
      >
        <p>{t("disclaimer")}</p>
        <p className="mt-3">
          <SiteLink href={ROUTES.contact.path} className={LINK}>
            {t("askFoa")}
          </SiteLink>
        </p>
      </aside>
    </div>
  );
}

/** The page for the requested slug; params resolve inside the boundary. */
async function Listing({ params }: PageProps<"/ngos/[slug]">) {
  const listing = await publicListing((await params).slug);
  if (!listing) notFound();
  return <ListingView listing={listing} />;
}

export default function Page(props: PageProps<"/ngos/[slug]">) {
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<DetailFallback />}>
        <Listing {...props} />
      </Suspense>
    </Section>
  );
}

/** The App Shell's stand-in for the page while it renders. */
async function DetailFallback() {
  const t = await getTranslations("directory.public");
  return (
    <output className="block">
      <span className="sr-only">{t("loading")}</span>
      <span aria-hidden="true" className="grid max-w-xl gap-4">
        <span className="block h-8 w-32 rounded-full bg-surface-muted" />
        <span className="block h-14 rounded-2xl bg-surface-muted" />
        <span className="block h-24 rounded-2xl bg-surface-muted" />
      </span>
    </output>
  );
}
