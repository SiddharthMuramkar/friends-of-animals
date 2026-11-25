import { getTranslations } from "next-intl/server";
import { SelectField, SubmitButton, TextField } from "@/components/form";
import type { JudgingRound } from "@/server/db/schema";
import { AWARD_SCHEMES } from "@/server/modules/competitions/domain/award-schemes";
import { JUDGING_LEVELS } from "@/server/modules/judging/domain/round-settings";
import { roundAction } from "../_lib/actions";
export const CARD =
  "flex flex-col gap-4 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";
export async function RoundForm({
  round,
  competitions,
}: {
  round?: JudgingRound;
  competitions?: { id: string; name: string }[];
}) {
  const t = await getTranslations("adminJudging");
  return (
    <form
      action={roundAction}
      className={CARD}
      aria-label={t(round ? "settings" : "create")}
    >
      <input
        type="hidden"
        name="operation"
        value={round ? "update" : "create"}
      />
      {round ? (
        <input type="hidden" name="roundId" value={round.id} />
      ) : (
        <SelectField
          name="competitionId"
          id="round-competition"
          label={t("competition")}
          placeholder={t("chooseCompetition")}
          options={(competitions ?? []).map((c) => ({
            value: c.id,
            label: c.name,
          }))}
          required
        />
      )}
      <TextField
        name="name"
        id="round-name"
        label={t("name")}
        required
        maxLength={120}
        defaultValue={round?.name}
      />
      <SelectField
        name="level"
        id="round-level"
        label={t("level")}
        placeholder={t("chooseLevel")}
        defaultValue={round?.level ?? "national"}
        options={JUDGING_LEVELS.map((value) => ({
          value,
          label: t(`levels.${value}`),
        }))}
        required
      />
      <SelectField
        name="awardScheme"
        id="round-awards"
        label={t("awardScheme")}
        placeholder={t("chooseAward")}
        defaultValue={round?.awardScheme ?? "competition_default"}
        options={[
          ...(round
            ? []
            : [
                {
                  value: "competition_default",
                  label: t("competitionDefault"),
                },
              ]),
          ...AWARD_SCHEMES.map((value) => ({
            value,
            label: t(`awardSchemes.${value}`),
          })),
        ]}
        required
      />
      <label className="flex min-h-12 items-center gap-3 font-semibold">
        <input
          type="checkbox"
          name="judgesPhysical"
          defaultChecked={round?.judgesPhysical ?? true}
          className="size-5 accent-link"
        />
        {t("physical")}
      </label>
      <SubmitButton pendingLabel={t("working")}>
        {t(round ? "save" : "create")}
      </SubmitButton>
    </form>
  );
}
