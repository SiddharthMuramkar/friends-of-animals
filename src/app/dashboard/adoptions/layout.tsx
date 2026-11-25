import { AdoptionDisclaimer } from "@/components/adoption/disclaimer";
import { Section } from "@/components/site/section";

// Every adoption page states that FOA facilitates adoption and the listing
// organisation is responsible for the animal (#129), an applicant's own
// pages included (#130).
export default function AdoptionsLayout({
  children,
}: LayoutProps<"/dashboard/adoptions">) {
  return (
    <>
      {children}
      <Section hue="green" width="prose" className="py-8 sm:py-10">
        <AdoptionDisclaimer />
      </Section>
    </>
  );
}
