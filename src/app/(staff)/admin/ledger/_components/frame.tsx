import type { ReactNode } from "react";

import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ADMIN_LEDGER } from "@/lib/app-routes";

export function LedgerFrame({
  title,
  back,
  children,
}: {
  title: string;
  back?: string;
  children: ReactNode;
}) {
  return (
    <Section hue="neutral" tone="tint" className="pt-10 sm:pt-14">
      {back ? (
        <SiteLink
          href={ADMIN_LEDGER}
          className="mb-3 inline-flex min-h-11 items-center text-link underline"
        >
          {back}
        </SiteLink>
      ) : null}
      <PageHeader title={title} />
      <div className="mt-6 space-y-6">{children}</div>
    </Section>
  );
}
