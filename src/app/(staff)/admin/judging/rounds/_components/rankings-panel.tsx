import { getTranslations } from "next-intl/server";
import { SelectField, SubmitButton, TextAreaField } from "@/components/form";
import { SectionHeading } from "@/components/site/heading";
import type { as } from "@/server/app";
import { AWARD_BANDS } from "@/server/modules/competitions/domain/award-schemes";
import {
  rational,
  formatRational,
} from "@/server/modules/judging/domain/rational";
import { OVERRIDE_REASON_LIMITS } from "@/server/modules/judging/domain/round-lock";
import { CARD } from "./round-form";
import { roundAction } from "../_lib/actions";

export async function RankingsPanel({
  api,
  roundId,
  mayManage,
  mayOverride,
}: {
  api: ReturnType<typeof as>;
  roundId: string;
  mayManage: boolean;
  mayOverride: boolean;
}) {
  const t = await getTranslations("adminJudging");
  const disciplines = await getTranslations("adminRubrics.disciplines");
  const data = await api.getRoundRankings({ roundId });
  if (!data.ok) return <p>{t("rankingsClosed")}</p>;
  const {
    round,
    ranked,
    unscored,
    categoryLabels,
    assignedCount,
    unscoredCount,
  } = data;
  const locked = round.status === "locked";
  const hiddenFields = (operation: string) => (
    <>
      <input type="hidden" name="operation" value={operation} />
      <input type="hidden" name="roundId" value={roundId} />
    </>
  );
  const options = [
    { value: "none", label: t("recognitions.none") },
    ...AWARD_BANDS[round.awardScheme].map((band, index) => ({
      value: `${index === 0 ? "winner" : "runner_up"}:${index + 1}`,
      label: `${t(index === 0 ? "recognitions.winner" : "recognitions.runner_up")} · ${t(`awardBands.${band}`)}`,
    })),
    { value: "finalist", label: t("recognitions.finalist") },
    { value: "special_mention", label: t("recognitions.special_mention") },
  ];
  const category = (
    item: (typeof ranked)[number] | (typeof unscored)[number]
  ) =>
    `${disciplines(item.discipline)} · ${categoryLabels[item.categoryId] ?? t("unknownCategory")}`;
  const groups = new Map<string, typeof ranked>();
  for (const item of ranked) {
    const key = `${item.discipline}/${item.categoryId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <>
      <section className={CARD}>
        <p>{t("rankingRule")}</p>
        <p>{t("tieRule")}</p>
        <p>{t(locked ? "lockedRanking" : "liveRanking")}</p>
        {!locked ? (
          <p>
            {t("scoringCount", {
              assigned: assignedCount ?? 0,
              unscored: unscoredCount ?? 0,
            })}
          </p>
        ) : null}
        {locked && round.lockOverrideReason ? (
          <p className="break-words">
            {t("overrideRecorded", { reason: round.lockOverrideReason })}
          </p>
        ) : null}
        {!locked && (mayManage || mayOverride) ? (
          <form
            action={roundAction}
            aria-label={t("lockRound")}
            className="flex flex-col gap-3"
          >
            {hiddenFields("lock")}
            <p>{t("lockLead")}</p>
            <SubmitButton pendingLabel={t("working")}>
              {t("lockRound")}
            </SubmitButton>
          </form>
        ) : null}
        {!locked &&
        mayOverride &&
        (unscoredCount !== 0 || assignedCount === 0) ? (
          <form
            action={roundAction}
            aria-label={t("overrideLock")}
            className="flex flex-col gap-3 border-t border-border pt-4"
          >
            {hiddenFields("override-lock")}
            <TextAreaField
              id="override-reason"
              name="overrideReason"
              label={t("overrideReason")}
              hint={t("overrideHelp")}
              required
              minLength={OVERRIDE_REASON_LIMITS.min}
              maxLength={OVERRIDE_REASON_LIMITS.max}
            />
            <SubmitButton pendingLabel={t("working")}>
              {t("overrideLock")}
            </SubmitButton>
          </form>
        ) : null}
      </section>
      {locked && mayManage ? <p>{t("tagLead")}</p> : null}
      {!ranked.length ? <p>{t("noRanked")}</p> : null}
      {[...groups.entries()].map(([key, items]) => (
        <section key={key} className={CARD}>
          <SectionHeading title={category(items[0]!)} />
          <ul className="flex flex-col gap-4">
            {items.map((item) => {
              const recognition =
                item.awardPosition === null
                  ? item.outcome
                  : `${item.outcome}:${item.awardPosition}`;
              return (
                <li
                  key={item.entryId}
                  className="flex flex-col gap-2 border-b border-border pb-4 last:border-b-0"
                >
                  <p className="font-bold break-words">
                    {t("place", { rank: item.rank, code: item.code })}
                  </p>
                  <p>
                    {t("weightedScore", {
                      score: formatRational(
                        rational(
                          BigInt(item.scoreNumerator),
                          BigInt(item.scoreDenominator)
                        )
                      ),
                      sheets: item.sheetsCounted,
                    })}
                  </p>
                  {item.decidedBy && item.decidedBy !== "score" ? (
                    <p className="text-ink-muted">
                      {t(
                        item.decidedBy === "shared"
                          ? "sharedRank"
                          : item.decidedBy === "median"
                            ? "medianTie"
                            : "criterionTie"
                      )}
                    </p>
                  ) : null}
                  {locked ? (
                    mayManage ? (
                      <form
                        className="flex flex-col gap-3"
                        action={roundAction}
                        aria-label={t("tagFor", { code: item.code })}
                      >
                        {hiddenFields("tag")}
                        <input
                          type="hidden"
                          name="entryId"
                          value={item.entryId}
                        />
                        <SelectField
                          id={`recognition-${item.entryId}`}
                          name="recognition"
                          label={t("recognition")}
                          options={options}
                          defaultValue={recognition}
                          placeholder={t("chooseRecognition")}
                          required
                        />
                        <label className="flex min-h-12 items-center gap-3">
                          <input
                            type="checkbox"
                            name="suitableForAuction"
                            defaultChecked={item.suitableForAuction}
                            className="size-5 accent-link"
                          />
                          {t("auctionSuitable")}
                        </label>
                        <SubmitButton pendingLabel={t("working")}>
                          {t("saveRecognition")}
                        </SubmitButton>
                      </form>
                    ) : (
                      <p>
                        {
                          options.find((option) => option.value === recognition)
                            ?.label
                        }
                        {item.suitableForAuction
                          ? ` · ${t("auctionSuitable")}`
                          : ""}
                      </p>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <section className={CARD}>
        <SectionHeading title={t("unscored")} />
        <p>{t("unscoredLead")}</p>
        {unscored.length ? (
          <ul className="list-disc ps-5">
            {unscored.map((item) => (
              <li key={item.entryId}>
                {item.code} · {category(item)}
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("none")}</p>
        )}
      </section>
    </>
  );
}
