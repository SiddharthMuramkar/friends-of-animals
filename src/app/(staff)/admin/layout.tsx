import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";

import { APP_ROUTES } from "@/lib/app-routes";

import { AdminNav, AdminNavView } from "./_components/admin-nav";

// Signed-in pages carry a per-request CSP nonce (src/proxy.ts, #65), which
// a static shell's build-time scripts can't have. Waiting for the request
// here, above every Suspense boundary, leaves the whole tree to request
// time; `instant = false` lets it build with an empty static shell.
export const instant = false;

/**
 * The admin area's shell: its navigation over each page. It reads no
 * session; each page checks the actor itself, inside <Suspense>. #60 adds
 * the staff second-factor gate here.
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
            <AdminNav {...nav} />
          </Suspense>
        </div>
      </div>
      {children}
    </>
  );
}
