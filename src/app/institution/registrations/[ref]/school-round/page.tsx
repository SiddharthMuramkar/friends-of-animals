import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";

import { inputStyles, SubmitButton, TextField } from "@/components/form";
import { OutcomeNotice } from "@/components/form/outcome-notice";
import { ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import {
  APP_ROUTES,
  conductCertificationPath,
  institutionSubmissionsPath,
  judgingGuidePath,
} from "@/lib/app-routes";
import {
  JUDGING_STATEMENT_VERSION,
  PANEL_FIELD_MAX,
  PANEL_MAX_MEMBERS,
  type RoundCategoryView,
  type SchoolRoundView,
} from "@/server/modules/school-round";

import { EntryStatusChip } from "../../../../participant/entries/_components/entry-status";
import { actingFor } from "../submissions/_lib/acting-institution";
import {
  finaliseSchoolRoundAction,
  recordPanelAction,
  saveShortlistAction,
} from "./_lib/actions";
import {
  decodeProblems,
  isRoundOutcome,
  isSuccess,
  type RoundOutcome,
  type ShownProblem,
} from "./_lib/outcome";

// Render the document on each request so its scripts carry the CSP nonce
// (#65): `instant = false` lets it build with an empty static shell.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("schoolRound.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/institution/registrations/[ref]/school-round">;

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

export default async function Page(props: Props) {
  await connection();
  const t = await getTranslations("schoolRound");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Round {...props} />
      </Suspense>
    </Section>
  );
}

async function Round({ params, searchParams }: Props) {
  const [{ ref }, query, t] = await Promise.all([
    params,
    searchParams,
    getTranslations("schoolRound"),
  ]);
  const { app, institutionId } = await actingFor(query.institution);
  const view = institutionId
    ? await app.getSchoolRound({ institutionId, reference: ref })
    : null;
  if (!institutionId || !view?.ok) {
    const state =
      view && !view.ok && view.error === "not_open" ? "notOpen" : "notFound";
    return (
      <ExplainState
        className="mt-8"
        title={t(`${state}.title`)}
        back={
          institutionId && state === "notOpen"
            ? {
                href: institutionSubmissionsPath(ref, institutionId),
                label: t("back"),
              }
            : { href: APP_ROUTES.dashboard, label: t("back") }
        }
      >
        <p>{t(`${state}.body`)}</p>
      </ExplainState>
    );
  }
  const done = isRoundOutcome(query.done) ? query.done : undefined;
  return (
    <RoundView
      round={view.round}
      institutionId={institutionId}
      done={done}
      noticeKey={typeof query.n === "string" ? query.n : undefined}
      problemCategory={typeof query.cat === "string" ? query.cat : undefined}
      problems={decodeProblems(query.pr)}
    />
  );
}

type Hidden = { institutionId: string; reference: string };

function HiddenRef({ institutionId, reference }: Hidden) {
  return (
    <>
      <input type="hidden" name="institutionId" value={institutionId} />
      <input type="hidden" name="reference" value={reference} />
    </>
  );
}

async function RoundView({
  round,
  institutionId,
  done,
  noticeKey,
  problemCategory,
  problems,
}: {
  round: SchoolRoundView;
  institutionId: string;
  done: RoundOutcome | undefined;
  noticeKey: string | undefined;
  problemCategory: string | undefined;
  problems: ShownProblem[];
}) {
  const [t, callout] = await Promise.all([
    getTranslations("schoolRound"),
    getTranslations("common.callout"),
  ]);
  const hidden = { institutionId, reference: round.reference };
  return (
    <div className="mt-8 flex flex-col gap-8">
      <div>
        <p className="text-lead font-semibold text-ink wrap-anywhere">
          {t("for", {
            institution: round.institutionName,
            competition: round.competition.name,
          })}
        </p>
        <p className="mt-1 font-mono text-sm text-ink-muted">
          {t("reference", { reference: round.reference })}
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-2">
          <Chip tone={round.status === "open" ? "marigold" : "green"}>
            {t(`status.${round.status}`)}
          </Chip>
        </p>
        <p className="mt-3 text-ink">
          {t("limits", {
            shortlist: round.limits.shortlistSize,
            positions: round.limits.positions,
          })}
        </p>
        <ButtonLink
          href={judgingGuidePath(round.competition.code)}
          variant="quiet"
          className="-ms-5 mt-2"
        >
          {t("judgingGuide")}
        </ButtonLink>
      </div>

      {done ? (
        <OutcomeNotice
          key={noticeKey ?? done}
          tone={isSuccess(done) ? "success" : "danger"}
          label={isSuccess(done) ? callout("success") : callout("danger")}
          message={t(`outcome.${done}`)}
        />
      ) : null}

      <PanelSection round={round} hidden={hidden} />
      {round.finalised ? (
        <ResultSection round={round} />
      ) : (
        <>
          <ShortlistSection
            round={round}
            hidden={hidden}
            problemCategory={problemCategory}
            problems={problems}
          />
          <FinaliseSection round={round} hidden={hidden} />
        </>
      )}

      <p>
        <ButtonLink
          href={institutionSubmissionsPath(round.reference, institutionId)}
          variant="quiet"
          className="-ms-5"
        >
          {t("back")}
        </ButtonLink>
      </p>
    </div>
  );
}

async function PanelSection({
  round,
  hidden,
}: {
  round: SchoolRoundView;
  hidden: Hidden;
}) {
  const t = await getTranslations("schoolRound.panel");
  const rows = Math.min(PANEL_MAX_MEMBERS, Math.max(2, round.panel.length + 1));
  return (
    <section aria-labelledby="round-panel" className={CARD}>
      <SectionHeading id="round-panel" title={t("title")} />
      {round.canEdit ? (
        <form action={recordPanelAction} className="mt-4 flex flex-col gap-5">
          <p className="text-ink-muted">
            {t("lead", { max: PANEL_MAX_MEMBERS })}
          </p>
          <HiddenRef {...hidden} />
          {Array.from({ length: rows }, (_, n) => (
            <fieldset key={n} className="flex flex-col gap-3">
              <legend className="font-semibold text-ink">
                {t("member", { n: n + 1 })}
              </legend>
              <TextField
                id={`panel-name-${n}`}
                name={`fullName.${n}`}
                label={t("fullName")}
                defaultValue={round.panel[n]?.fullName ?? ""}
                maxLength={PANEL_FIELD_MAX}
                autoComplete="off"
              />
              <TextField
                id={`panel-role-${n}`}
                name={`designation.${n}`}
                label={t("designation")}
                hint={n === 0 ? t("designationHint") : undefined}
                defaultValue={round.panel[n]?.designation ?? ""}
                maxLength={PANEL_FIELD_MAX}
                autoComplete="off"
              />
            </fieldset>
          ))}
          <div>
            <SubmitButton pendingLabel={t("saving")}>{t("save")}</SubmitButton>
          </div>
        </form>
      ) : round.panel.length === 0 ? (
        <p className="mt-3 text-ink-muted">{t("none")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1 text-ink">
          {round.panel.map((member, n) => (
            <li key={n} className="wrap-anywhere">
              <span className="font-semibold">{member.fullName}</span>,{" "}
              {member.designation}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function ShortlistSection({
  round,
  hidden,
  problemCategory,
  problems,
}: {
  round: SchoolRoundView;
  hidden: Hidden;
  problemCategory: string | undefined;
  problems: ShownProblem[];
}) {
  const t = await getTranslations("schoolRound.shortlist");
  return (
    <section aria-labelledby="round-shortlist" className="flex flex-col gap-6">
      <SectionHeading id="round-shortlist" title={t("title")} />
      {round.categories.length === 0 ? (
        <p className="text-ink-muted">{t("empty")}</p>
      ) : (
        round.categories.map((category) => (
          <CategoryForm
            key={category.id}
            round={round}
            category={category}
            hidden={hidden}
            problems={problemCategory === category.id ? problems : []}
          />
        ))
      )}
    </section>
  );
}

async function CategoryForm({
  round,
  category,
  hidden,
  problems,
}: {
  round: SchoolRoundView;
  category: RoundCategoryView;
  hidden: Hidden;
  problems: ShownProblem[];
}) {
  const [t, discipline, problem] = await Promise.all([
    getTranslations("schoolRound.shortlist"),
    getTranslations("schoolRound.discipline"),
    getTranslations("schoolRound.problem"),
  ]);
  const headingId = `category-${category.id}`;
  const problemsId = `${headingId}-problems`;
  const codeOf = (entryId: string | null) =>
    category.entries.find((each) => each.entryId === entryId)?.code ?? "";
  const picked = category.entries.filter((each) => each.picked).length;
  return (
    <section aria-labelledby={headingId} className={CARD}>
      <h3 id={headingId} className="wrap-anywhere">
        {t("category", {
          discipline: discipline(category.discipline),
          ageGroup: category.ageGroupLabel,
        })}
      </h3>
      <p className="mt-1 text-sm text-ink-muted">
        {t("pickedCount", {
          count: picked,
          limit: round.limits.shortlistSize,
        })}
      </p>
      {problems.length > 0 ? (
        <ul
          id={problemsId}
          className="mt-4 flex list-disc flex-col gap-1 ps-5 font-semibold text-danger"
        >
          {problems.map((each, n) => (
            <li key={n}>
              {problem(each.code, {
                code: codeOf(each.entryId),
                count: each.count ?? 0,
                limit: each.limit ?? 0,
              })}
            </li>
          ))}
        </ul>
      ) : null}
      <form
        action={saveShortlistAction}
        className="mt-4 flex flex-col gap-4"
        aria-describedby={problems.length > 0 ? problemsId : undefined}
      >
        <HiddenRef {...hidden} />
        <input type="hidden" name="categoryId" value={category.id} />
        <ul className="flex flex-col gap-3">
          {category.entries.map((each) => {
            const pickId = `pick-${each.entryId}`;
            const positionId = `position-${each.entryId}`;
            return (
              <li
                key={each.entryId}
                className="rounded-2xl border-2 border-border p-4"
              >
                <p className="font-semibold text-ink wrap-anywhere">
                  {each.studentName}
                </p>
                <p className="mt-1 text-sm text-ink-muted wrap-anywhere">
                  <span className="font-mono">{each.code}</span> · {each.title}
                </p>
                <p className="mt-2">
                  <EntryStatusChip status={each.status} />
                </p>
                {each.submitted ? (
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                    <label
                      htmlFor={pickId}
                      className="flex min-h-11 items-center gap-3 font-semibold text-ink"
                    >
                      <input
                        id={pickId}
                        type="checkbox"
                        name="pick"
                        value={each.entryId}
                        defaultChecked={each.picked}
                        className="size-5 accent-green-700"
                      />
                      {t("pick", { code: each.code })}
                    </label>
                    {round.limits.positions > 0 ? (
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor={positionId}
                          className="text-sm font-semibold text-ink"
                        >
                          {t("position", { code: each.code })}
                        </label>
                        <select
                          id={positionId}
                          name={`position.${each.entryId}`}
                          defaultValue={each.position?.toString() ?? ""}
                          className={inputStyles}
                        >
                          <option value="">{t("noPosition")}</option>
                          {Array.from(
                            { length: round.limits.positions },
                            (_, n) => (
                              <option key={n} value={n + 1}>
                                {t("positionOption", { n: n + 1 })}
                              </option>
                            )
                          )}
                        </select>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-ink-muted">
                    {t("notSubmitted")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <div>
          <SubmitButton pendingLabel={t("saving")}>{t("save")}</SubmitButton>
        </div>
      </form>
    </section>
  );
}

async function FinaliseSection({
  round,
  hidden,
}: {
  round: SchoolRoundView;
  hidden: Hidden;
}) {
  const t = await getTranslations("schoolRound.finalise");
  if (round.competition.digitalScope !== "all_participants") {
    return (
      <section aria-labelledby="round-finalise" className={CARD}>
        <SectionHeading id="round-finalise" title={t("title")} />
        <p className="mt-3 text-ink">{t("shortlistOnly")}</p>
      </section>
    );
  }
  const blocked = new Set(round.blockers.map((blocker) => blocker.code));
  const picksOk =
    !blocked.has("pick_not_in_round") && !blocked.has("pick_not_submitted");
  const shortlisted = round.categories
    .flatMap((category) => category.entries)
    .filter((each) => each.picked).length;
  const checks = [
    { key: "panel", ok: !blocked.has("panel_missing") },
    { key: "conduct", ok: !blocked.has("conduct_not_certified") },
    { key: "picks", ok: picksOk },
  ] as const;
  return (
    <section aria-labelledby="round-finalise" className={CARD}>
      <SectionHeading id="round-finalise" title={t("title")} />
      <p className="mt-3 text-ink-muted">{t("lead")}</p>
      <h3 className="mt-5">{t("checklist")}</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {checks.map((check) => (
          <li
            key={check.key}
            className="flex flex-wrap items-center gap-2 text-ink"
          >
            <Chip tone={check.ok ? "green" : "pink"}>
              {check.ok ? t("done") : t("todo")}
            </Chip>
            <span>{t(check.key)}</span>
            {check.key === "conduct" && !check.ok ? (
              <ButtonLink
                href={conductCertificationPath(
                  round.reference,
                  hidden.institutionId
                )}
                variant="quiet"
              >
                {t("conductLink")}
              </ButtonLink>
            ) : null}
          </li>
        ))}
      </ul>
      <h3 className="mt-5">{t("summaryTitle")}</h3>
      <p className="mt-2 text-ink">
        {t("summary", {
          shortlisted,
          others: round.entryCount - shortlisted,
        })}
      </p>
      {round.canEdit ? (
        <form action={finaliseSchoolRoundAction} className="mt-5">
          <HiddenRef {...hidden} />
          <h3>{t("statementTitle")}</h3>
          <p className="mt-2 text-ink">
            {t("statement", {
              institution: round.institutionName,
              competition: round.competition.name,
            })}
          </p>
          <p className="mt-2 font-mono text-sm text-ink-muted">
            {t("version", { version: JUDGING_STATEMENT_VERSION })}
          </p>
          <label
            htmlFor="judging-attested"
            className="mt-4 flex min-h-11 items-center gap-3 font-semibold text-ink"
          >
            <input
              id="judging-attested"
              type="checkbox"
              name="judgingAttested"
              value="yes"
              className="size-5 accent-green-700"
            />
            {t("attest")}
          </label>
          <div className="mt-4">
            <SubmitButton pendingLabel={t("submitting")}>
              {t("submit")}
            </SubmitButton>
          </div>
        </form>
      ) : null}
    </section>
  );
}

async function ResultSection({ round }: { round: SchoolRoundView }) {
  const [t, finalise, shortlist, discipline, format] = await Promise.all([
    getTranslations("schoolRound.result"),
    getTranslations("schoolRound.finalise"),
    getTranslations("schoolRound.shortlist"),
    getTranslations("schoolRound.discipline"),
    getFormatter(),
  ]);
  const { finalised } = round;
  const all = round.categories.flatMap((category) => category.entries);
  const others = round.entryCount - all.filter((each) => each.picked).length;
  return (
    <section aria-labelledby="round-result" className={CARD}>
      <SectionHeading id="round-result" title={t("title")} />
      {finalised ? (
        <p className="mt-3 text-ink">
          {finalised.byName
            ? finalise("finalised", {
                name: finalised.byName,
                date: format.dateTime(finalised.at, "longDateTime"),
              })
            : finalise("finalisedByFormer", {
                date: format.dateTime(finalised.at, "longDateTime"),
              })}
        </p>
      ) : null}
      {all.every((each) => !each.picked) ? (
        <p className="mt-3 text-ink-muted">{t("none")}</p>
      ) : (
        round.categories.map((category) => {
          const picked = category.entries.filter((each) => each.picked);
          if (picked.length === 0) return null;
          return (
            <div key={category.id} className="mt-5">
              <h3 className="wrap-anywhere">
                {shortlist("category", {
                  discipline: discipline(category.discipline),
                  ageGroup: category.ageGroupLabel,
                })}
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {picked.map((each) => (
                  <li key={each.entryId} className="text-ink wrap-anywhere">
                    <span className="font-semibold">{each.studentName}</span> ·{" "}
                    <span className="font-mono text-sm">{each.code}</span>
                    {each.position ? (
                      <>
                        {" "}
                        ·{" "}
                        <Chip tone="green">
                          {shortlist("placed", { n: each.position })}
                        </Chip>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
      <p className="mt-5 text-ink-muted">
        {t("notShortlisted", { count: others })}
      </p>
    </section>
  );
}
