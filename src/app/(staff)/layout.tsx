import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";

import { Section } from "@/components/site/section";

import { StaffGate } from "./_components/staff-gate";

/**
 * Every staff page (the admin area and later staff trees) sits behind the
 * staff second-factor gate. Its fallback prerenders; the gate and the page
 * stream in once the session is checked.
 */
export default async function StaffLayout({
  children,
}: {
  children: ReactNode;
}) {
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
