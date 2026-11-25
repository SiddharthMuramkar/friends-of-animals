import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ADMIN_HOME, adminQueuePath } from "@/lib/app-routes";
import { as,currentActor } from "@/server/app";
import { QUEUE_KEYS, type QueueKey } from "@/server/modules/reports/queues";
import { AdminDenied } from "../../_components/admin-denied";
import { adminCall } from "../../_lib/boundary";

function queueKey(value: string): QueueKey {
  if (!QUEUE_KEYS.includes(value as QueueKey)) notFound();
  return value as QueueKey;
}
export async function generateMetadata({params}: {params: Promise<{key:string}>}): Promise<Metadata> {
  const t = await getTranslations("adminHome");
  const key = queueKey((await params).key);
  return { title:t(`queue.${key}`),robots:{index:false,follow:false} };
}

const LINK = "inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-4 hover:text-link-hover";

export default async function Page({params,searchParams}: {params: Promise<{key:string}>; searchParams:Promise<{cursor?:string|string[]}>}) {
  const [{key:raw}, query, t, formatter, actor] = await Promise.all([params,searchParams,getTranslations("adminHome"),getFormatter(),currentActor()]);
  const key = queueKey(raw);
  const cursor = typeof query.cursor === "string" ? query.cursor : undefined;
  const call = await adminCall(() => as(actor).listQueueItems({key,cursor}), adminQueuePath(key));
  if(call.ok && !call.value.ok) notFound();
  return (
    <Section width="wide" className="pt-10 sm:pt-14">
      <SiteLink href={ADMIN_HOME} className={LINK}>{t("back")}</SiteLink>
      <PageHeader title={t(`queue.${key}`)} className="mt-4"/>
      {!call.ok ? <AdminDenied /> : call.value.ok ? <>
        <p className="mt-5 font-semibold">{t("waiting",{count:call.value.count})}</p>
        <ul className="mt-5 flex flex-col gap-3">
          {call.value.items.map(item=>(
            <li key={item.id} className="rounded-2xl border-2 border-border bg-surface p-4">
              <SiteLink href={item.href} prefetch={false} className={`${LINK} wrap-anywhere`}>{t("open",{code:item.code})}</SiteLink>
              {item.competitionCode ? <p>{t("competition",{code:item.competitionCode})}</p> : null}
              <p className="text-ink-muted">{t("since",{date:formatter.dateTime(item.waitingSince,"longDateTime")})}</p>
              {item.overdue ? <p className="font-semibold">{t("overdueItem")}</p> : null}
              {item.mine ? <p className="font-semibold">{t("mine")}</p> : null}
            </li>
          ))}
        </ul>
        {call.value.nextCursor ? <SiteLink className={LINK} href={`${adminQueuePath(key)}?cursor=${encodeURIComponent(call.value.nextCursor)}`}>{t("next")}</SiteLink> : null}
      </> : null}
    </Section>
  );
}
