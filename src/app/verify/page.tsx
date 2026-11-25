import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { buttonStyles } from "@/components/site/button-link";
export const metadata = {
  title: "Verify a certificate",
  robots: { index: false, follow: false },
};
export const instant = false;
export default async function Page() {
  await connection();
  const t = await getTranslations("certificates");
  return (
    <Section
      width="prose"
      hue="green"
      tone="tint"
      className="pt-10 sm:pt-14 min-h-svh"
    >
      <PageHeader title={t("verify")} lead={t("verifyLead")} />
      <search>
        <form
          method="get"
          action="/verify/lookup"
          className="mt-8 grid gap-4 rounded-3xl border-2 border-border bg-surface p-5 sm:p-6"
        >
          <label htmlFor="certificate-number" className="font-semibold">
            {t("number")}
          </label>
          <input
            id="certificate-number"
            name="number"
            type="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            maxLength={64}
            aria-describedby="number-help"
            className="min-h-12 w-full rounded-xl border-2 border-border-strong bg-surface p-3 text-ink"
          />
          <p id="number-help" className="text-ink-muted">
            {t("numberHelp")}
          </p>
          <button
            type="submit"
            className={buttonStyles({ variant: "primary" })}
          >
            {t("lookup")}
          </button>
        </form>
      </search>
    </Section>
  );
}
