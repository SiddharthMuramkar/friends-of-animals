import { getTranslations } from "next-intl/server";

import { Chip } from "@/components/site/chip";
import type { AdoptionAnswers } from "@/server/modules/adoption/domain/application-input";
import type { AdoptionApplicationStatus } from "@/server/modules/adoption/domain/application-status";

// Pieces the adoption application pages share (#130): the status as a
// chip, and what an applicant told FOA. Server Components only.

const TONE: Record<
  AdoptionApplicationStatus,
  "neutral" | "blue" | "green" | "marigold"
> = {
  submitted: "blue",
  under_review: "blue",
  in_contact: "marigold",
  adopted: "green",
  not_matched: "neutral",
  declined: "neutral",
  withdrawn: "neutral",
  listing_closed: "neutral",
};

export async function ApplicationStatusChip({
  status,
}: {
  status: AdoptionApplicationStatus;
}) {
  const t = await getTranslations("adoptionApplications.status");
  return <Chip tone={TONE[status]}>{t(status)}</Chip>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm font-semibold text-ink-muted">{label}</dt>
      <dd className="text-ink whitespace-pre-line wrap-anywhere">{value}</dd>
    </div>
  );
}

/** The applicant's contact and answers, as a definition list. */
export async function ApplicantDetailsList({
  details,
  name,
}: {
  details: { phone: string; address: string; answers: AdoptionAnswers };
  /** Shown first when the reader is someone other than the applicant. */
  name?: { label: string; value: string };
}) {
  const [t, home] = await Promise.all([
    getTranslations("adoptionApplications.facts"),
    getTranslations("adoptionApplications.homeType"),
  ]);
  const { answers } = details;
  const or = (value: string) => (value.trim() === "" ? t("none") : value);
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
      {name ? <Fact label={name.label} value={name.value} /> : null}
      <Fact label={t("phone")} value={details.phone} />
      <Fact label={t("address")} value={details.address} />
      <Fact label={t("homeType")} value={home(answers.homeType)} />
      <Fact
        label={t("outdoor")}
        value={answers.hasOutdoorSpace ? t("outdoorYes") : t("outdoorNo")}
      />
      <Fact label={t("otherAnimals")} value={or(answers.otherAnimals)} />
      <Fact label={t("experience")} value={or(answers.experience)} />
      <Fact label={t("why")} value={answers.whyThisAnimal} />
    </dl>
  );
}
