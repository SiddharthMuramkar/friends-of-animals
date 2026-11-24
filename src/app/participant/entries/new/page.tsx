import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES, entryDetailPath } from "@/lib/app-routes";
import { uploadRuleFor } from "@/server/modules/entries/rules";

import { EntryUpload } from "../_components/entry-upload";
import { readParticipantEntries } from "../_lib/read";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("entries");
  return { title: t("new.title"), robots: { index: false, follow: false } };
}

export default async function NewEntryPage({
  searchParams,
}: PageProps<"/participant/entries/new">) {
  const { registration } = await searchParams;
  if (typeof registration !== "string") notFound();
  const [result, t, format] = await Promise.all([
    readParticipantEntries((app) =>
      app.getEntryUploadOptions({ registrationId: registration })
    ),
    getTranslations("entries"),
    getFormatter(),
  ]);

  if (!result.ok && result.error === "entry_exists") {
    redirect(entryDetailPath(result.code));
  }
  if (!result.ok && result.error === "invalid_input") notFound();

  return (
    <Section width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        title={
          result.ok
            ? t("new.forCompetition", { competition: result.competition })
            : t("new.title")
        }
      />
      <ButtonLink
        href={APP_ROUTES.participant}
        variant="secondary"
        className="mt-4"
      >
        {t("backToCompetitions")}
      </ButtonLink>
      {result.ok ? (
        <>
          {result.whose === "child" ? (
            <p className="mt-6 font-semibold text-ink">
              {t("forChild", { name: result.participantName })}
            </p>
          ) : null}
          <p className="mt-4 text-ink-muted">
            {t("deadline", {
              date: format.dateTime(result.closesAt, "longDateTime"),
            })}
          </p>
          <EntryUpload
            registrationId={registration}
            options={result.disciplines.map((value) => ({
              value,
              rule: uploadRuleFor(value)!,
            }))}
            mode="submit"
          />
        </>
      ) : (
        <p className="mt-6 text-ink">{t(`errors.${result.error}`)}</p>
      )}
    </Section>
  );
}
