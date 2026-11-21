import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { Section } from "@/components/site/section";

import { StaffGate } from "./_components/staff-gate";

// Staff pages are signed-in pages, so they carry a per-request CSP nonce
// (src/proxy.ts, #65) that a static shell's build-time scripts can't have.
// As in app/account/layout.tsx, waiting for the request here, above the
// gate's Suspense boundary, leaves the whole document to request time (the
// boundary's fallback would otherwise prerender as the shell), and
// `instant = false` lets this tree build with an empty static shell.
export const instant = false;

/**
 * Every staff page (the admin area and later staff trees) sits behind the
 * staff second-factor gate. Its fallback streams first; the gate and the
 * page follow once the session is checked.
 */
export default async function StaffLayout({
  children,
}: {
  children: ReactNode;
}) {
  await connection();
  const t = await getTranslations("security.gate");
  return (
    <Suspense
      fallback={
        <Section width="prose" className="pt-10 sm:pt-14">
          <p className="text-ink-muted">{t("checking")}</p>
        </Section>
      }
    >
      <StaffGate>{children}</StaffGate>
    </Suspense>
  );
}
