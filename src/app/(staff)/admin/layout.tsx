import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense, type ComponentProps } from "react";

import { ADMIN_LEDGER, APP_ROUTES } from "@/lib/app-routes";
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
      { href: APP_ROUTES.adminRoles, label: t("roles") },
      { href: APP_ROUTES.adminAudit, label: t("audit") },
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
  const finance =
    actor.kind === "user" && (await showLedgerNavigation(as(actor).myAccess));
  if (!finance) return <AdminNav {...nav} />;

  const t = await getTranslations("adminLedger.list");
  return (
    <AdminNav
      label={nav.label}
      links={[...nav.links, { href: ADMIN_LEDGER, label: t("title") }]}
    />
  );
}
