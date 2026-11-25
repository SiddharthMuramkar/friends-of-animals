import { getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { messages } from "@/i18n/messages";
import { LOCALE } from "@/i18n/formats";
import { notFound, redirect } from "next/navigation";
import { Section } from "@/components/site/section";
import { PageHeader } from "@/components/site/heading";
import { judgeOnboardingPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { CARD } from "../../../../_components/common";
import { ScoreForm, type SaveStatus } from "./_components/score-form";
import { Work } from "./_components/work";
export async function generateMetadata() {
  const t = await getTranslations("judgeScoring");
  return { title: t("scoreTitle"), robots: { index: false, follow: false } };
}
type Props = PageProps<"/judge/rounds/[id]/entries/[entryCode]">;
// The judge layout is already request-dynamic (nonce protected). Await
// the form here rather than stream it behind Suspense: without JS React
// cannot replace the loading placeholder with the native Save form.
export default async function Page(props: Props) {
  const content = await Entry(props);
  return (
    <Section hue="teal" tone="tint" width="wide" className="pt-10 sm:pt-14">
      {content}
    </Section>
  );
}
async function Entry({ params, searchParams }: Props) {
  const [{ id, entryCode }, query, actor] = await Promise.all([
    params,
    searchParams,
    currentActor(),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const result = await as(actor).getBlindEntry({ roundId: id, entryCode });
  if (!result.ok) {
    if (result.error === "not_onboarded") redirect(judgeOnboardingPath(id));
    notFound();
  }
  const {
    view,
    round,
    criteria,
    sheet,
    progress,
    previousEntryCode,
    nextEntryCode,
  } = result;
  const possibleStatuses: readonly SaveStatus[] = [
    "saved",
    "conflict",
    "invalid",
    "closed",
    "locked",
  ];
  const initialStatus =
    possibleStatuses.find((status) => query.saved === status) ?? "idle";
  return (
    <NextIntlClientProvider
      locale={LOCALE}
      timeZone="Asia/Kolkata"
      messages={{ judgeScoring: messages.judgeScoring }}
    >
      <div className="flex flex-col gap-6">
        <PageHeader
          title={view.entryCode}
          eyebrow={round.name}
          tile="teal"
          lead={view.categoryLabel}
        />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section className={CARD}>
            <Work view={view} />
          </section>
          <section className={CARD}>
            <ScoreForm
              key={view.entryCode}
              roundId={id}
              entryCode={view.entryCode}
              criteria={criteria}
              sheet={sheet}
              progress={progress}
              locked={round.status === "locked"}
              previousEntryCode={previousEntryCode}
              nextEntryCode={nextEntryCode}
              initialStatus={initialStatus}
            />
          </section>
        </div>
      </div>
    </NextIntlClientProvider>
  );
}
