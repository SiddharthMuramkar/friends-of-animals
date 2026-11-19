import { jsonLdScript } from "@/lib/seo";

/** Structured data as a plain script tag (no next/script needed). */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }}
    />
  );
}
