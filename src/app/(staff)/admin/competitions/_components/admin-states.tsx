import { CheckCircle2, PencilLine } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { FormAlert } from "@/components/form";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { APP_ROUTES } from "@/lib/app-routes";
import type { CompetitionStatus } from "@/server/modules/competitions";

/**
 * What a signed-in person without the competition manager role sees: the
 * use case refused, so there is nothing to show. A page never calls
 * forbidden(): authInterrupts is off.
 */
export async function CompetitionsDenied() {
  const t = await getTranslations("adminCompetitions.denied");
  return (
    <ExplainState
      title={t("title")}
      back={{ href: APP_ROUTES.accountSessions, label: t("back") }}
      className="mt-8"
    >
      <p>{t("body")}</p>
    </ExplainState>
  );
}

/** A competition id that names nothing the manager can open. */
export async function CompetitionNotFound() {
  const t = await getTranslations("adminCompetitions.notFound");
  return (
    <ExplainState
      title={t("title")}
      back={{ href: APP_ROUTES.adminCompetitions, label: t("back") }}
      className="mt-8"
    >
      <p>{t("body")}</p>
    </ExplainState>
  );
}

/** Draft or published, with an icon as well as a colour. */
export async function StatusChip({ status }: { status: CompetitionStatus }) {
  const t = await getTranslations("adminCompetitions.status");
  return status === "draft" ? (
    <Chip icon={<PencilLine aria-hidden="true" />}>{t("draft")}</Chip>
  ) : (
    <Chip tone="green" icon={<CheckCircle2 aria-hidden="true" />}>
      {t(status)}
    </Chip>
  );
}

const DONE = ["created", "saved", "published"] as const;
type Done = (typeof DONE)[number];

/** The notice after a save or a publish (`?done=`), announced politely. */
export async function DoneNotice({
  done,
}: {
  done: string | string[] | undefined;
}) {
  if (typeof done !== "string" || !DONE.includes(done as Done)) return null;
  const [t, callout] = await Promise.all([
    getTranslations("adminCompetitions.done"),
    getTranslations("common.callout"),
  ]);
  return (
    <FormAlert tone="success" label={callout("success")} className="mt-8">
      <p>{t(done as Done)}</p>
    </FormAlert>
  );
}
