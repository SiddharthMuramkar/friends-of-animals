import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { SubmitButton } from "@/components/form";
import { Chip } from "@/components/site/chip";
import type {
  ChildConsentDocument,
  ChildConsentPurpose,
  WithdrawChildConsentInput,
} from "@/server/modules/consent";

import { giveChildConsentAction, withdrawChildConsentAction } from "../actions";

export async function PurposeCard({
  childId,
  competitionId,
  consent,
  canGive,
  documentText,
  groupHeading,
}: {
  childId: string;
  competitionId?: string;
  consent: Pick<ChildConsentPurpose, "purpose" | "state" | "counts"> & {
    document: ChildConsentDocument | null;
  };
  canGive: boolean;
  documentText: ReactNode;
  groupHeading?: string;
}) {
  const t = await getTranslations("childConsents");
  const { purpose, document, state, counts } = consent;
  const heading = `consent-${competitionId ?? "global"}-${purpose}`;
  const input: WithdrawChildConsentInput = { childId, competitionId, purpose };
  const actions = [
    ...(canGive && document && !counts
      ? [
          {
            kind: "give",
            action: giveChildConsentAction.bind(null, {
              ...input,
              documentId: document.id,
            }),
          } as const,
        ]
      : []),
    ...(state.status === "given"
      ? [
          {
            kind: "withdraw",
            action: withdrawChildConsentAction.bind(null, input),
          } as const,
        ]
      : []),
  ];
  const Heading = competitionId ? "h3" : "h2";

  return (
    <article
      aria-labelledby={heading}
      className="flex flex-col gap-3 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Heading id={heading} className="text-lead font-bold text-ink">
          {t(`purposes.${purpose}`)}
        </Heading>
        <Chip>
          {t(
            `state.${state.status === "given" && !counts && document ? "outdated" : state.status}`
          )}
        </Chip>
      </div>
      {document ? (
        documentText
      ) : (
        <p className="text-ink-muted">{t("unavailable")}</p>
      )}
      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {actions.map(({ kind, action }) => {
            const buttonId = `${heading}-${kind}`;
            return (
              <form
                key={kind}
                action={action}
                aria-labelledby={[groupHeading, heading, buttonId]
                  .filter(Boolean)
                  .join(" ")}
              >
                <SubmitButton
                  variant={kind === "withdraw" ? "secondary" : "primary"}
                  pendingLabel={t("saving")}
                >
                  <span id={buttonId}>{t(kind)}</span>
                </SubmitButton>
              </form>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
