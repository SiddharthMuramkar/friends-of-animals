import { notFound } from "next/navigation";

// Stub: the competition page's own task replaces this with real content and slugs.
// Cache Components needs at least one param; the placeholder renders a 404.
export function generateStaticParams() {
  return [{ slug: "__placeholder__" }];
}

export default async function Page({
  params,
}: PageProps<"/competitions/[slug]">) {
  await params;
  notFound();
}
