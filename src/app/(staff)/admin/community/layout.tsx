import { getTranslations } from "next-intl/server";
import { SiteLink } from "@/components/site/site-link";
import {
  ADMIN_COMMUNITY_MEMBERS,
  ADMIN_CLUBS,
  ADMIN_AMBASSADORS,
} from "@/lib/app-routes";

export default async function CommunityLayout({
  children,
}: LayoutProps<"/admin/community">) {
  const t = await getTranslations("community.admin");
  return (
    <>
      <nav aria-label={t("nav")} className="border-b border-border bg-surface">
        <ul className="mx-auto flex max-w-7xl flex-wrap gap-3 px-4 py-3 sm:px-6">
          <li>
            <SiteLink
              href={ADMIN_COMMUNITY_MEMBERS}
              className="inline-flex min-h-11 items-center text-link underline underline-offset-4"
            >
              {t("members")}
            </SiteLink>
          </li>
          <li>
            <SiteLink
              href={ADMIN_CLUBS}
              className="inline-flex min-h-11 items-center text-link underline underline-offset-4"
            >
              {t("clubs")}
            </SiteLink>
          </li>
          <li>
            <SiteLink
              href={ADMIN_AMBASSADORS}
              className="inline-flex min-h-11 items-center text-link underline underline-offset-4"
            >
              {t("ambassadors")}
            </SiteLink>
          </li>
        </ul>
      </nav>
      {children}
    </>
  );
}
