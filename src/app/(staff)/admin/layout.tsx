import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense, type ComponentProps } from "react";

import {
  ADMIN_HOME,
  ADMIN_REPORTS,
  ADMIN_ADOPTIONS,
  ADMIN_AUCTIONS,
  ADMIN_JUDGING_ROUNDS,
  ADMIN_VERIFICATION,
  ADMIN_ARTWORK,
  ADMIN_CERTIFICATES,
  ADMIN_BREACHES,
  ADMIN_DONATIONS,
  ADMIN_CAMPAIGNS,
  ADMIN_LEDGER,
  ADMIN_PRIVACY,
  ADMIN_PRIVACY_REQUESTS,
  ADMIN_VOLUNTEERS,
  ADMIN_COMMUNITY_MEMBERS,
  APP_ROUTES,
} from "@/lib/app-routes";
import { env } from "@/env";
import { as, currentActor } from "@/server/app";

import { AdminNav, AdminNavView } from "./_components/admin-nav";
import { FactsReadiness } from "./_components/facts-readiness";
import { showLedgerNavigation } from "./_lib/ledger-navigation";

// Signed-in pages carry a per-request CSP nonce (src/proxy.ts, #65), which
// a static shell's build-time scripts can't have. Waiting for the request
// here, above every Suspense boundary, leaves the whole tree to request
// time; `instant = false` lets it build with an empty static shell.
export const instant = false;

/**
 * The admin area's shell: its navigation over each page, and for staff
 * who look after them, which of FOA's organisation facts are still
 * missing. The parent (staff) layout holds #60's second-factor gate, and
 * each page checks the actor's permission itself, inside <Suspense>.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await connection();
  const t = await getTranslations("admin.nav");
  const nav = {
    label: t("label"),
    links: [
      { href: ADMIN_HOME, label: t("home") },
      { href: APP_ROUTES.adminRoles, label: t("roles") },
      { href: APP_ROUTES.adminAudit, label: t("audit") },
      { href: ADMIN_BREACHES, label: t("breaches") },
      { href: ADMIN_CAMPAIGNS, label: t("campaigns") },
      ...(env().APP_ENV === "production"
        ? []
        : [{ href: APP_ROUTES.adminConsentForms, label: t("consentForms") }]),
      { href: ADMIN_PRIVACY, label: t("privacy") },
      { href: ADMIN_PRIVACY_REQUESTS, label: t("privacyRequests") },
      { href: ADMIN_COMMUNITY_MEMBERS, label: t("community") },
      { href: ADMIN_VOLUNTEERS, label: t("volunteers") },
      { href: ADMIN_JUDGING_ROUNDS, label: t("judging") },
      { href: ADMIN_VERIFICATION, label: t("verification") },
      { href: ADMIN_ARTWORK, label: t("artwork") },
      { href: ADMIN_CERTIFICATES, label: t("certificates") },
      { href: ADMIN_AUCTIONS, label: t("auctions") },
      { href: ADMIN_ADOPTIONS, label: t("adoptions") },
    ],
  };
  return (
    <>
      <div className="border-b border-border bg-surface">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <Suspense fallback={<AdminNavView {...nav} pathname={null} />}>
            <AdminNavWithLedger {...nav} />
          </Suspense>
        </div>
      </div>
      <Suspense fallback={null}>
        <FactsReadiness />
      </Suspense>
      {children}
    </>
  );
}

async function AdminNavWithLedger(nav: ComponentProps<typeof AdminNav>) {
  const actor = await currentActor();
  const access = actor.kind === "user" ? await as(actor).myAccess() : null;
  const reports = access?.grants.some(g => ["super_admin", "staff_admin", "finance", "competition_manager"].includes(g.role));
  const tNav = await getTranslations("admin.nav");
  const links = reports
    ? [nav.links[0]!, { href: ADMIN_REPORTS, label: tNav("reports") }, ...nav.links.slice(1)]
    : nav.links;
  const finance = actor.kind === "user" && (await showLedgerNavigation(as(actor).myAccess));
  if (!finance) return <AdminNav {...nav} links={links} />;

  const [t, donations] = await Promise.all([
    getTranslations("adminLedger.list"),
    getTranslations("adminDonations"),
  ]);
  return (
    <AdminNav
      label={nav.label}
      links={[
        ...links,
        { href: ADMIN_LEDGER, label: t("title") },
        // Finance's donations (#106).
        { href: ADMIN_DONATIONS, label: donations("nav") },
      ]}
    />
  );
}
