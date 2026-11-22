import { FileText } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { SubmitButton } from "@/components/form";
import { Chip } from "@/components/site/chip";
import { SiteLink } from "@/components/site/site-link";
import { documentVersionPath } from "@/server/modules/competitions/domain/consent-attachments";
import type { DocumentForEdit } from "@/server/modules/competitions/terms";

import { documentAction } from "../_lib/actions";

const LINK =
  "inline-flex min-h-11 items-center gap-2 font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

/**
 * The documents registering agrees to, one per purpose: which version the
 * competition pins, whether a newer one is out, and buttons to attach
 * (or move to) the latest version, or to detach it.
 */
export async function DocumentsSection({
  competitionId,
  documents,
}: {
  competitionId: string;
  documents: readonly DocumentForEdit[];
}) {
  const t = await getTranslations("adminCompetitionTerms.documents");
  return (
    <ul className="flex flex-col gap-5">
      {documents.map((document) => {
        const { purpose, pinned, latest, state } = document;
        const name = t(`name.${purpose}`);
        return (
          <li
            key={purpose}
            className="rounded-2xl border-2 border-border p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-h4 leading-tight">
                {t(`purpose.${purpose}`)}
              </h3>
              {document.required ? (
                <Chip tone="blue">{t("required")}</Chip>
              ) : null}
            </div>
            <p className="mt-2 text-ink">
              {state === "not_attached"
                ? t("state.not_attached")
                : state === "current"
                  ? t("state.current", { version: pinned?.version ?? 0 })
                  : t("state.newer_available", {
                      version: pinned?.version ?? 0,
                      latest: latest?.version ?? 0,
                    })}
            </p>
            {latest ? null : (
              <p className="mt-1 text-ink-muted">{t("noVersion")}</p>
            )}
            {pinned ? (
              <SiteLink
                href={documentVersionPath(purpose, pinned.version)}
                className={LINK}
              >
                <FileText aria-hidden="true" className="size-5 shrink-0" />
                {t("view", { name, version: pinned.version })}
              </SiteLink>
            ) : null}
            {latest || pinned ? (
              <form
                action={documentAction}
                className="mt-3 flex flex-wrap gap-3"
              >
                <input
                  type="hidden"
                  name="competitionId"
                  value={competitionId}
                />
                <input type="hidden" name="purpose" value={purpose} />
                {latest && state !== "current" ? (
                  <SubmitButton
                    name="intent"
                    value="attach"
                    pendingLabel={t("working")}
                  >
                    {state === "not_attached"
                      ? t("attach", { name, version: latest.version })
                      : t("move", { name, version: latest.version })}
                  </SubmitButton>
                ) : null}
                {pinned ? (
                  <SubmitButton
                    name="intent"
                    value="detach"
                    variant="secondary"
                    pendingLabel={t("working")}
                  >
                    {t("detach", { name })}
                  </SubmitButton>
                ) : null}
              </form>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
