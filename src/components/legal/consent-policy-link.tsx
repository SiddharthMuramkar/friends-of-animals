import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { SiteLink } from "@/components/site/site-link";
import type { LegalVersion } from "@/server/modules/cms";
import {
  cmsPublicPath,
  legalKeyForConsentPurpose,
  type LinkedConsentPurpose,
} from "@/server/modules/cms/domain/documents";

const LINK =
  "text-link underline decoration-1 underline-offset-2 hover:text-link-hover";

/**
 * The policy page a consent document rests on (#111, F11), linked, with
 * the version the page shows now: the privacy policy, for the messages
 * consent. The consent document records the page revision it was
 * published against; people read the page as it is today.
 */
export async function ConsentPolicyLink({
  purpose,
  current,
  className,
}: {
  purpose: LinkedConsentPurpose;
  /** The page's published version, or null before version 1. */
  current: LegalVersion | null;
  className?: string;
}) {
  const t = await getTranslations("legal.common");
  const key = legalKeyForConsentPurpose(purpose);
  const values = {
    page: t(`policyPages.${key}`),
    link: (chunks: ReactNode) => (
      <SiteLink href={cmsPublicPath(key)} className={LINK}>
        {chunks}
      </SiteLink>
    ),
  };
  return (
    <p className={className}>
      {current
        ? t.rich("policyLink", { ...values, version: current.version })
        : t.rich("policyLinkNoVersion", values)}
    </p>
  );
}
