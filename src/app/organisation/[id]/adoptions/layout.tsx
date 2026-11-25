import { AdoptionDisclaimer } from "@/components/adoption/disclaimer";
import { Section } from "@/components/site/section";

// Every adoption page, the representatives' own included, states that FOA
// facilitates adoption and the listing organisation is responsible for
// the animal (#129).
export default function AdoptionsLayout({
  children,
}: LayoutProps<"/organisation/[id]/adoptions">) {
  return (
    <>
      {children}
      <Section hue="green" width="prose" className="py-8 sm:py-10">
        <AdoptionDisclaimer />
      </Section>
    </>
  );
}
