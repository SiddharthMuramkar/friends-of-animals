import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ADMIN_HOME } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { AdminDenied } from "./_components/admin-denied";
import { adminCall } from "./_lib/boundary";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminHome");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function Page() {
  const [t, formatter, actor] = await Promise.all([getTranslations("adminHome"), getFormatter(), currentActor()]);
  const call = await adminCall(() => as(actor).getAdminHome(), ADMIN_HOME);
  return (
    <Section width="wide" className="pt-10 sm:pt-14">
      <PageHeader title={t("title")} lead={t("lead")} />
      {!call.ok ? <AdminDenied /> : call.value.queues.length === 0 ?
        <p className="mt-8 text-ink-muted">{t("empty")}</p> :
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {call.value.queues.map(queue => (
            <li key={queue.key} className="min-w-0">
              <SiteLink href={queue.href} prefetch={false} className="flex h-full flex-col gap-3 rounded-3xl border-2 border-border bg-surface p-5 hover:border-ink">
                <h2 className="text-lead font-bold text-link">{t(`queue.${queue.key}`)}</h2>
                <p className="font-semibold tabular-nums text-ink">{t("waiting",{count:queue.count})}</p>
                {queue.oldestWaitingSince ? <p className="text-ink-muted">{t("oldest",{date:formatter.dateTime(queue.oldestWaitingSince,"long")})}</p> : null}
                {queue.overdue !== undefined && queue.overdue > 0 ? <p className="font-semibold text-ink">{t("overdue",{count:queue.overdue})}</p> : null}
              </SiteLink>
            </li>
          ))}
        </ul>
      }
    </Section>
  );
}
