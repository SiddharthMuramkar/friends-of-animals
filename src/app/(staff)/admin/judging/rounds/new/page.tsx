import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ADMIN_JUDGING_ROUNDS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import { AdminDenied } from "../../../_components/admin-denied";
import { RoundForm } from "../_components/round-form";
import { Outcome } from "../_components/outcome";
export const metadata = { robots: { index: false, follow: false } };
type Props = PageProps<"/admin/judging/rounds/new">;
export default async function Page(props: Props) {
  const t = await getTranslations("adminJudging");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader title={t("create")} tile="blue" />
      <Suspense fallback={<p>{t("loading")}</p>}>
        <NewRound {...props} />
      </Suspense>
    </Section>
  );
}
async function NewRound({ searchParams }: Props) {
  await connection();
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  try {
    return await renderNewRound(as(actor), searchParams);
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden")
      return <AdminDenied />;
    throw error;
  }
}

async function renderNewRound(
  api: ReturnType<typeof as>,
  searchParams: Props["searchParams"]
) {
  const t = await getTranslations("adminJudging");
  const competitions = await api.listCompetitionsForAdmin();
  return (
    <div className="mt-8 flex flex-col gap-4">
      <ButtonLink variant="quiet" href={ADMIN_JUDGING_ROUNDS}>
        {t("back")}
      </ButtonLink>
      <Outcome query={await searchParams} />
      <RoundForm competitions={competitions} />
    </div>
  );
}
