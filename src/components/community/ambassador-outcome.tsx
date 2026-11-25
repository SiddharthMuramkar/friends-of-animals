import { getTranslations } from "next-intl/server";
import { OutcomeNotice } from "@/components/form/outcome-notice";

const OUTCOMES = [
  "submitted",
  "approved",
  "declined",
  "ineligible",
  "invalid_input",
  "invalid_transition",
  "self_review",
  "not_found",
  "forbidden",
] as const;
export async function AmbassadorOutcome({
  query,
}: {
  query: Record<string, string | string[] | undefined>;
}) {
  const done = OUTCOMES.find((value) => value === query.done);
  if (!done) return null;
  const [t, callout] = await Promise.all([
    getTranslations("ambassadors.outcome"),
    getTranslations("common.callout"),
  ]);
  const success =
    done === "submitted" || done === "approved" || done === "declined";
  return (
    <OutcomeNotice
      key={typeof query.n === "string" ? query.n : done}
      tone={success ? "success" : "danger"}
      label={success ? callout("success") : callout("danger")}
      message={t(done)}
    />
  );
}
