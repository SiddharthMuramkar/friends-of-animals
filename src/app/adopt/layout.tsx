import { AdoptionDisclaimer } from "@/components/adoption/disclaimer";
import { Section } from "@/components/site/section";

// Every public adoption page states that FOA facilitates adoption and the
// listing organisation is responsible for the animal (#129).
export default function AdoptLayout({ children }: LayoutProps<"/adopt">) {
  return (
    <>
      {children}
      <Section hue="green" className="py-8 sm:py-10">
        <AdoptionDisclaimer />
      </Section>
    </>
  );
}
