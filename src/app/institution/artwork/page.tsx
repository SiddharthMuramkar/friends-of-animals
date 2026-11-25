import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SenderPage } from "@/components/artwork/sender-page";
// Signed-in, nonce-CSP pages read their actor and artwork at request time.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("artwork");
  return { title: t("title"), robots: { index: false, follow: false } };
}
export default async function Page({
  searchParams,
}: PageProps<"/institution/artwork">) {
  return (
    <SenderPage route="institution" result={(await searchParams).result} />
  );
}
