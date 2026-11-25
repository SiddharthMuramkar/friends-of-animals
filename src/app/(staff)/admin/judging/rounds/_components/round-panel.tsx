import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import {
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
} from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { ADMIN_JUDGING_ROUNDS, adminJudgingRoundPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import { acceptsJudges } from "@/server/modules/judging/domain/round-status";
import { AdminDenied } from "../../../_components/admin-denied";
import { CARD, RoundForm } from "./round-form";
import { RankingsPanel } from "./rankings-panel";
import { Outcome, type Query } from "./outcome";
import { roundAction } from "../_lib/actions";
const tabs = [
  "settings",
  "judges",
  "pool",
  "assignments",
  "conflicts",
  "rankings",
] as const;
type Tab = (typeof tabs)[number];
type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Query>;
  tab: Tab;
};
export async function RoundPanel(props: Props) {
  const t = await getTranslations("adminJudging");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p>{t("loading")}</p>}>
        <Panel {...props} />
      </Suspense>
    </Section>
  );
}
async function Panel({ params, searchParams, tab }: Props) {
  await connection();
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const api = as(actor);
  try {
    return await renderPanel(api, id, query, tab);
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden")
      return <AdminDenied />;
    throw error;
  }
}

async function renderPanel(
  api: ReturnType<typeof as>,
  id: string,
  query: Query,
  tab: Tab
) {
  const t = await getTranslations("adminJudging");
  const result = await api.getJudgingRound({ roundId: id });
  if (!result.ok) return <p>{t("outcomes.not_found")}</p>;
  const { round, pins } = result;
  const access = await api.myAccess();
  const mayManage = access.grants.some(
    (g) =>
      g.role === "competition_manager" &&
      (g.scope.type === "global" ||
        (g.scope.type === "competition" && g.scope.id === round.competitionId))
  );
  const mayOverride = access.grants.some(
    (g) =>
      (g.role === "staff_admin" || g.role === "super_admin") &&
      (g.scope.type === "global" ||
        (g.scope.type === "competition" && g.scope.id === round.competitionId))
  );
  const editable = mayManage && acceptsJudges(round.status);
  const base = adminJudgingRoundPath(round.id);
  const fields = (operation: string) => (
    <>
      <input type="hidden" name="roundId" value={round.id} />
      <input type="hidden" name="operation" value={operation} />
    </>
  );
  const submit = (label: string) => (
    <SubmitButton pendingLabel={t("working")}>{label}</SubmitButton>
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={round.name}
        lead={`${t(`levels.${round.level}`)} · ${t(`statuses.${round.status}`)}`}
        tile="blue"
      />
      <ButtonLink variant="quiet" href={ADMIN_JUDGING_ROUNDS}>
        {t("back")}
      </ButtonLink>
      <nav aria-label={t("tabs")}>
        <ul className="flex flex-wrap gap-2">
          {tabs.map((item) => (
            <li key={item}>
              <SiteLink
                href={item === "settings" ? base : `${base}/${item}`}
                aria-current={tab === item ? "page" : undefined}
                className={`inline-flex min-h-12 items-center rounded-xl border-2 border-border px-3 font-semibold ${tab === item ? "bg-surface" : "text-link"}`}
              >
                {t(item)}
              </SiteLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outcome query={query} />
      <SectionHeading title={t(tab)} />
      {tab === "rankings" ? (
        <RankingsPanel
          api={api}
          roundId={id}
          mayManage={mayManage}
          mayOverride={mayOverride}
        />
      ) : null}
      {tab === "settings" ? (
        <>
          <dl className={CARD}>
            <dt className="font-semibold">{t("level")}</dt>
            <dd>{t(`levels.${round.level}`)}</dd>
            <dt className="font-semibold">{t("awardScheme")}</dt>
            <dd>{t(`awardSchemes.${round.awardScheme}`)}</dd>
            <dt className="font-semibold">{t("entryRule")}</dt>
            <dd>{t(round.judgesPhysical ? "physical" : "digital")}</dd>
          </dl>
          <section className={CARD}>
            <SectionHeading title={t("rubrics")} />
            <ul className="list-disc ms-5">
              {pins.map((pin) => (
                <li key={pin.discipline}>
                  {pin.discipline} · {t("version", { version: pin.version })}
                </li>
              ))}
            </ul>
          </section>
          {editable && round.status === "draft" ? (
            <>
              <RoundForm round={round} />
              <form
                action={roundAction}
                aria-label={t("openForm")}
                className={CARD}
              >
                {fields("open")}
                {submit(t("openRound"))}
              </form>
            </>
          ) : null}
          {editable ? (
            <form
              action={roundAction}
              aria-label={t("cancelRound")}
              className={CARD}
            >
              {fields("cancel")}
              <TextAreaField
                id="cancel-reason"
                name="reason"
                label={t("reason")}
                required
                maxLength={500}
              />
              {submit(t("cancelRound"))}
            </form>
          ) : null}
        </>
      ) : null}
      {tab === "judges"
        ? await (async () => {
            const data = await api.listRoundJudges({ roundId: id });
            if (!data.ok) return null;
            return (
              <>
                {editable ? (
                  <form
                    className={CARD}
                    action={roundAction}
                    aria-label={t("inviteJudge")}
                  >
                    {fields("invite")}
                    <TextField
                      id="judge-email"
                      name="email"
                      type="email"
                      label={t("email")}
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                      maxLength={254}
                    />
                    {submit(t("inviteJudge"))}
                  </form>
                ) : null}
                <section className={CARD}>
                  <SectionHeading title={t("invitations")} />
                  {data.invitations.length ? (
                    <ul className="flex flex-col gap-4">
                      {data.invitations.map((i) => (
                        <li key={i.id} className="border-b border-border pb-3">
                          <p className="wrap-anywhere">
                            {i.email} · {t(`invitationStatuses.${i.status}`)}
                          </p>
                          {editable && i.status === "pending" ? (
                            <form
                              action={roundAction}
                              aria-label={t("revokeFor", { email: i.email })}
                            >
                              {fields("revoke")}
                              <input
                                type="hidden"
                                name="invitationId"
                                value={i.id}
                              />
                              {submit(t("revoke"))}
                            </form>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{t("none")}</p>
                  )}
                </section>
                <section className={CARD}>
                  <SectionHeading title={t("acceptedJudges")} />
                  {data.judges.length ? (
                    <ul className="flex flex-col gap-4">
                      {data.judges.map((j) => (
                        <li
                          key={j.userId}
                          className="border-b border-border pb-3"
                        >
                          <p>
                            {j.name} ·{" "}
                            {t(j.readiness.ready ? "ready" : "notReady")}
                          </p>
                          {editable ? (
                            <form
                              action={roundAction}
                              aria-label={t("removeFor", { name: j.name })}
                            >
                              {fields("remove")}
                              <input
                                type="hidden"
                                name="judgeUserId"
                                value={j.userId}
                              />
                              {submit(t("removeJudge"))}
                            </form>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{t("none")}</p>
                  )}
                </section>
              </>
            );
          })()
        : null}
      {tab === "pool"
        ? await (async () => {
            const data = await api.getRoundPool({ roundId: id });
            if (!data.ok) return null;
            return (
              <>
                {editable ? (
                  <form
                    action={roundAction}
                    aria-label={t("admit")}
                    className={CARD}
                  >
                    {fields("admit")}
                    <p>
                      {t(round.judgesPhysical ? "physicalRule" : "digitalRule")}
                    </p>
                    {submit(t("admit"))}
                  </form>
                ) : null}
                <section className={CARD}>
                  <SectionHeading title={t("pool")} />
                  {data.entries.length ? (
                    <ul className="flex flex-col gap-3">
                      {data.entries.map((e) => (
                        <li key={e.entryId}>
                          <p className="font-semibold">{e.code}</p>
                          <p>
                            {e.discipline} ·{" "}
                            {t("assignmentCount", {
                              count: e.assignmentCount,
                            })}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{t("none")}</p>
                  )}
                </section>
              </>
            );
          })()
        : null}
      {tab === "assignments"
        ? await (async () => {
            const [data, judges, pool] = await Promise.all([
              api.listAssignments({ roundId: id }),
              api.listRoundJudges({ roundId: id }),
              api.getRoundPool({ roundId: id }),
            ]);
            if (!data.ok || !judges.ok || !pool.ok) return null;
            return (
              <>
                {editable ? (
                  <form
                    className={CARD}
                    action={roundAction}
                    aria-label={t("assign")}
                  >
                    {fields("assign")}
                    <SelectField
                      id="assign-judge"
                      name="judgeUserId"
                      label={t("judge")}
                      placeholder={t("chooseJudge")}
                      options={judges.judges
                        .filter((j) => j.readiness.ready)
                        .map((j) => ({ value: j.userId, label: j.name }))}
                      required
                    />
                    <fieldset className="flex flex-col gap-2">
                      <legend>{t("selectEntries")}</legend>
                      {pool.entries.map((e) => (
                        <label
                          key={e.entryId}
                          className="flex min-h-12 items-center gap-3"
                        >
                          <input
                            type="checkbox"
                            name="entryIds"
                            value={e.entryId}
                            className="size-5 accent-link"
                          />
                          {e.code}
                        </label>
                      ))}
                    </fieldset>
                    {submit(t("assign"))}
                  </form>
                ) : null}
                <section className={CARD}>
                  <SectionHeading title={t("assignments")} />
                  {data.assignments.length ? (
                    <ul className="flex flex-col gap-4">
                      {data.assignments.map((a) => (
                        <li key={`${a.judgeUserId}-${a.entryId}`}>
                          <p>
                            {a.judgeName} · {a.code} · {a.discipline}
                          </p>
                          {editable ? (
                            <form
                              action={roundAction}
                              aria-label={t("unassignFor", {
                                name: a.judgeName,
                                code: a.code,
                              })}
                            >
                              {fields("unassign")}
                              <input
                                type="hidden"
                                name="judgeUserId"
                                value={a.judgeUserId}
                              />
                              <input
                                type="hidden"
                                name="entryId"
                                value={a.entryId}
                              />
                              {submit(t("unassign"))}
                            </form>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{t("none")}</p>
                  )}
                </section>
              </>
            );
          })()
        : null}
      {tab === "conflicts"
        ? await (async () => {
            const [data, judges, pool] = await Promise.all([
              api.listRoundConflicts({ roundId: id }),
              api.listRoundJudges({ roundId: id }),
              api.getRoundPool({ roundId: id }),
            ]);
            if (!data.ok || !judges.ok || !pool.ok) return null;
            return (
              <>
                {editable ? (
                  <form
                    className={CARD}
                    action={roundAction}
                    aria-label={t("flagConflict")}
                  >
                    {fields("flag")}
                    <SelectField
                      name="judgeUserId"
                      id="flag-judge"
                      label={t("judge")}
                      placeholder={t("chooseJudge")}
                      options={judges.judges.map((j) => ({
                        value: j.userId,
                        label: j.name,
                      }))}
                      required
                    />
                    <SelectField
                      name="entryId"
                      id="flag-entry"
                      label={t("entry")}
                      placeholder={t("chooseEntry")}
                      options={pool.entries.map((e) => ({
                        value: e.entryId,
                        label: e.code,
                      }))}
                      required
                    />
                    <TextAreaField
                      name="note"
                      id="flag-note"
                      label={t("note")}
                      maxLength={1000}
                    />
                    {submit(t("flagConflict"))}
                  </form>
                ) : null}
                <section className={CARD}>
                  <SectionHeading title={t("declarations")} />
                  {data.declarations.length ? (
                    <ul className="flex flex-col gap-4">
                      {data.declarations.map((d) => (
                        <li key={d.judgeUserId}>
                          <p className="font-semibold">{d.judgeName}</p>
                          <p>
                            {d.declaredAt
                              ? t(d.none ? "noConflicts" : "declaredConflicts")
                              : t("notReady")}
                          </p>
                          {d.statement ? (
                            <p className="whitespace-pre-wrap">{d.statement}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{t("none")}</p>
                  )}
                </section>
                <section className={CARD}>
                  <SectionHeading title={t("recordedConflicts")} />
                  {data.conflicts.length ? (
                    <ul className="flex flex-col gap-4">
                      {data.conflicts.map((c) => (
                        <li key={c.id}>
                          <p>
                            {judges.judges.find(
                              (j) => j.userId === c.judgeUserId
                            )?.name ?? t("removedJudge")}{" "}
                            ·{" "}
                            {t(
                              c.source === "declared"
                                ? "institutionConflict"
                                : "entryConflict"
                            )}{" "}
                            ·{" "}
                            {pool.entries.find((e) => e.entryId === c.entryId)
                              ?.code ??
                              c.institutionId ??
                              c.entryId}
                          </p>
                          {c.note ? <p>{c.note}</p> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{t("none")}</p>
                  )}
                </section>
              </>
            );
          })()
        : null}
    </div>
  );
}
