import type { SectionHue } from "@/lib/routes";

import { PageHeader } from "./heading";
import { Section } from "./section";

/** Temporary page body (title + one line) until the real page lands. */
export function StubPage({
  title,
  description,
  hue,
}: {
  title: string;
  description: string;
  hue: SectionHue;
}) {
  return (
    <Section hue={hue} tone="tint" className="py-16 sm:py-24">
      <PageHeader title={title} lead={description} />
    </Section>
  );
}
