import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Section } from "@/components/site/section";
export const CARD =
  "flex flex-col gap-4 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";
export async function JudgeSection({ children }: { children: ReactNode }) {
  return (
    <Section hue="teal" tone="tint" width="prose" className="pt-10 sm:pt-14">
      {children}
    </Section>
  );
}
export async function Loading() {
  const t = await getTranslations("judging");
  return <p>{t("loading")}</p>;
}
const outcomes = [
  "accepted",
  "declined",
  "acceptedTerms",
  "declared",
  "not_found",
  "sign_in_required",
  "email_mismatch",
  "already_accepted",
  "expired",
  "revoked",
  "round_closed",
  "invalid_input",
  "document_outdated",
  "forbidden",
  "failed",
] as const;
export async function Outcome({ done }: { done: unknown }) {
  const t = await getTranslations("judging");
  const code = outcomes.find((o) => o === done);
  return code ? (
    <output className="font-semibold">{t(`outcomes.${code}`)}</output>
  ) : null;
}
