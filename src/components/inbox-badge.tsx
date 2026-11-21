import { Inbox } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ButtonLink } from "@/components/site/button-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";

/**
 * The signed-in user's inbox link in the header, with their unread count
 * in words ("2 unread"), not a coloured dot. Reads the session, so the
 * header renders it under <Suspense>; visitors get nothing.
 */
export async function InboxBadge() {
  const actor = await currentActor();
  if (actor.kind !== "user") return null;
  const [t, unread] = await Promise.all([
    getTranslations("inbox.badge"),
    as(actor).countUnread(),
  ]);
  return (
    <ButtonLink href={APP_ROUTES.accountInbox} variant="secondary">
      <Inbox aria-hidden="true" />
      {/* One phrase for screen readers that starts with the visible words'
          meaning and holds them (WCAG 2.5.3). */}
      <span aria-hidden="true">
        {unread > 0 ? t("unread", { count: unread }) : t("inbox")}
      </span>
      <span className="sr-only">{t("label", { count: unread })}</span>
    </ButtonLink>
  );
}
