import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { SubmitButton, TextAreaField } from "@/components/form";
import { LegalBlockView, LegalInlines } from "@/components/legal/legal-text";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { JUDGE_DASHBOARD } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import type { DocumentRow } from "@/server/modules/consent/repository";
import { acceptsJudges } from "@/server/modules/judging/domain/round-status";
import {
  CARD,
  JudgeSection,
  Loading,
  Outcome,
} from "../../../_components/common";
import { onboardJudgeAction } from "../../../_lib/actions";
export const metadata = { robots: { index: false, follow: false } };
type Props = PageProps<"/judge/rounds/[id]/onboarding">;
export default function Page(props: Props) {
  return (
    <JudgeSection>
      <Suspense fallback={<Loading />}>
        <Onboarding {...props} />
      </Suspense>
    </JudgeSection>
  );
}
function Document({ doc }: { doc: DocumentRow }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-bold text-xl">{doc.title}</h3>
      <ul className="list-disc ms-5">
        {doc.body.short.map((text, k) => (
          <li key={k}>
            <LegalInlines text={text} />
          </li>
        ))}
      </ul>
      {doc.body.sections.map((section) => (
        <section key={section.id}>
          <h4 className="font-semibold">{section.title}</h4>
          {section.blocks.map((block, k) => (
            <LegalBlockView key={k} block={block} />
          ))}
        </section>
      ))}
    </section>
  );
}
async function Onboarding({ params, searchParams }: Props) {
  const [{ id }, query, actor, t] = await Promise.all([
    params,
    searchParams,
    currentActor(),
    getTranslations("judging"),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  try {
    return await renderOnboarding(as(actor), id, query);
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden")
      return (
        <>
          <PageHeader title={t("onboarding")} tile="teal" />
          <p>{t("outcomes.forbidden")}</p>
          <ButtonLink href={JUDGE_DASHBOARD}>{t("back")}</ButtonLink>
        </>
      );
    throw error;
  }
}

async function renderOnboarding(
  api: ReturnType<typeof as>,
  id: string,
  query: Awaited<Props["searchParams"]>
) {
  const t = await getTranslations("judging");
  const data = await api.getJudgeOnboarding({ roundId: id });
  if (!data.ok) return <p>{t("outcomes.not_found")}</p>;
  const { round, readiness, conduct, confidentiality } = data;
  const open = acceptsJudges(round.status);
  const termsDone =
    readiness.ready ||
    (!readiness.missing.includes("conduct") &&
      !readiness.missing.includes("confidentiality"));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={round.name} lead={t("onboarding")} tile="teal" />
      <ButtonLink href={JUDGE_DASHBOARD} variant="quiet">
        {t("back")}
      </ButtonLink>
      <Outcome done={query.done} />
      <output className="font-bold">
        {t(readiness.ready ? "ready" : "notReady")}
      </output>
      <section className={CARD}>
        <SectionHeading title={t("terms")} />
        {termsDone ? (
          <p>{t("termsDone")}</p>
        ) : !open ? (
          <p>{t("outcomes.round_closed")}</p>
        ) : !conduct || !confidentiality ? (
          <p>{t("noDocuments")}</p>
        ) : (
          <form
            action={onboardJudgeAction}
            className="flex flex-col gap-5"
            aria-label={t("terms")}
          >
            <input type="hidden" name="operation" value="terms" />
            <input type="hidden" name="roundId" value={id} />
            <input type="hidden" name="conductDocumentId" value={conduct.id} />
            <input
              type="hidden"
              name="confidentialityDocumentId"
              value={confidentiality.id}
            />
            <Document doc={conduct} />
            <label className="flex min-h-12 items-center gap-3 font-semibold">
              <input
                type="checkbox"
                name="conduct"
                required
                className="size-5 shrink-0 accent-link"
              />
              {t("acceptConduct")}
            </label>
            <Document doc={confidentiality} />
            <label className="flex min-h-12 items-center gap-3 font-semibold">
              <input
                type="checkbox"
                name="confidentiality"
                required
                className="size-5 shrink-0 accent-link"
              />
              {t("acceptConfidentiality")}
            </label>
            <SubmitButton pendingLabel={t("working")}>
              {t("saveTerms")}
            </SubmitButton>
          </form>
        )}
      </section>
      <section className={CARD}>
        <SectionHeading title={t("conflicts")} />
        <p>{t("conflictsLead")}</p>
        {open ? (
          <form
            action={onboardJudgeAction}
            className="flex flex-col gap-4"
            aria-label={t("conflicts")}
          >
            <input type="hidden" name="roundId" value={id} />
            <input type="hidden" name="operation" value="conflicts" />
            <fieldset className="flex flex-col gap-2">
              <legend className="font-semibold">{t("conflictsChoice")}</legend>
              <label className="flex min-h-12 items-center gap-3">
                <input
                  type="radio"
                  name="none"
                  value="yes"
                  required
                  defaultChecked={data.declaration.none}
                  className="size-5 accent-link"
                />
                {t("none")}
              </label>
              <label className="flex min-h-12 items-center gap-3">
                <input
                  type="radio"
                  name="none"
                  value="no"
                  required
                  defaultChecked={
                    !data.declaration.none &&
                    (data.declaration.institutionIds.length > 0 ||
                      Boolean(data.declaration.statement))
                  }
                  className="size-5 accent-link"
                />
                {t("some")}
              </label>
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="font-semibold">{t("institutions")}</legend>
              {data.institutions.map((i) => (
                <label key={i.id} className="flex min-h-12 items-center gap-3">
                  <input
                    type="checkbox"
                    name="institutionIds"
                    value={i.id}
                    defaultChecked={data.declaration.institutionIds.includes(
                      i.id
                    )}
                    className="size-5 accent-link"
                  />
                  {i.name}
                </label>
              ))}
            </fieldset>
            <TextAreaField
              name="statement"
              id="conflict-statement"
              label={t("statement")}
              maxLength={1000}
              defaultValue={data.declaration.statement}
            />
            <SubmitButton pendingLabel={t("working")}>
              {t("saveConflicts")}
            </SubmitButton>
          </form>
        ) : (
          <p>{t("outcomes.round_closed")}</p>
        )}
      </section>
    </div>
  );
}
