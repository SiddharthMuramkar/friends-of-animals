import { getTranslations } from "next-intl/server";
import { ClubShell } from "@/components/clubs/shared";
import { ClubDetail } from "@/components/clubs/detail";
export async function generateMetadata() {
  const t = await getTranslations("clubs");
  return { title: t("title"), robots: { index: false, follow: false } };
}
export default async function Page({
  params,
  searchParams,
}: PageProps<"/dashboard/clubs/[clubId]">) {
  const t = await getTranslations("clubs");
  return (
    <ClubShell title={t("title")} lead={t("intro")}>
      <Content params={params} searchParams={searchParams} />
    </ClubShell>
  );
}
async function Content({
  params,
  searchParams,
}: PageProps<"/dashboard/clubs/[clubId]">) {
  const [{ clubId }, query] = await Promise.all([params, searchParams]);
  return <ClubDetail clubId={clubId} admin={false} query={query} />;
}
