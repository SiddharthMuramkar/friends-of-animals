import { getTranslations } from "next-intl/server";

import { SubmitButton, TextAreaField, TextField } from "@/components/form";
import { SectionHeading } from "@/components/site/heading";
import { AUTHORITY_REFERENCE_MAX } from "@/server/modules/breaches/domain/authority-notice";
import { NO_NOTICE_REASON_MAX } from "@/server/modules/breaches/domain/breach-status";
import { BREACH_FAN_OUT_PAGE_SIZE } from "@/server/modules/breaches/domain/notice-recipients";
import type { BreachView } from "@/server/modules/breaches/read";

import {
  closeBreachAction,
  containBreachAction,
  notifyAffectedAction,
  notifyAllAction,
  notifyAuthorityAction,
} from "../actions";
import { BreachCheckbox } from "./breach-fields";

const FORM = "flex flex-col items-start gap-4 border-t border-border pt-5";

export async function BreachActions({ breach }: { breach: BreachView }) {
  const { id, allowedEvents, canNotifyAuthority, authority, status } = breach;
  if (!allowedEvents.length && !canNotifyAuthority) return null;
  const t = await getTranslations("adminBreaches.forms");
  const pendingLabel = t("pending");
  return (
    <section className="flex min-w-0 flex-col gap-5 rounded-3xl border-2 border-border bg-surface p-5 sm:p-6">
      <SectionHeading title={t("actions")} />
      {allowedEvents.includes("contain") ? (
        <form
          aria-label={t("contain")}
          action={containBreachAction.bind(null, id)}
        >
          <SubmitButton pendingLabel={pendingLabel}>
            {t("contain")}
          </SubmitButton>
        </form>
      ) : null}
      {allowedEvents.includes("notify") ? (
        <>
          <form
            aria-labelledby="target-notices"
            action={notifyAffectedAction.bind(null, id)}
            className={FORM}
          >
            <h3 id="target-notices">{t("targets")}</h3>
            <TextAreaField
              id="breach-subjects"
              name="subjects"
              label={t("subjects")}
              hint={t("subjectsHint", { count: BREACH_FAN_OUT_PAGE_SIZE })}
              rows={4}
              maxLength={BREACH_FAN_OUT_PAGE_SIZE * 256}
              spellCheck={false}
              className="w-full"
              required
            />
            <SubmitButton pendingLabel={pendingLabel}>
              {t("queueNotices")}
            </SubmitButton>
          </form>
          <form
            aria-labelledby="all-notices"
            action={notifyAllAction.bind(null, id)}
            className={FORM}
          >
            <h3 id="all-notices">{t("allUsers")}</h3>
            <BreachCheckbox
              name="confirmAll"
              label={t("confirmAll")}
              required
            />
            <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
              {t("allUsers")}
            </SubmitButton>
          </form>
        </>
      ) : null}
      {canNotifyAuthority ? (
        <form
          aria-labelledby="authority-notice"
          action={notifyAuthorityAction.bind(null, id)}
          className={FORM}
        >
          <h3 id="authority-notice">{t("authority")}</h3>
          {authority.emailConfigured ? (
            <p>{t("emailHint")}</p>
          ) : (
            <TextField
              id="authority-reference"
              name="manualReference"
              label={t("reference")}
              hint={t("referenceHint")}
              maxLength={AUTHORITY_REFERENCE_MAX}
              className="w-full"
              required
            />
          )}
          <SubmitButton pendingLabel={pendingLabel}>
            {authority.emailConfigured
              ? t(authority.emailFailedAt ? "retryAuthority" : "queueAuthority")
              : t("saveReference")}
          </SubmitButton>
        </form>
      ) : null}
      {allowedEvents.includes("close") ? (
        <form
          aria-label={t("closeSubmit")}
          action={closeBreachAction.bind(null, id)}
          className={FORM}
        >
          {status === "contained" ? (
            <TextAreaField
              id="breach-close-reason"
              name="reason"
              label={t("closeReason")}
              rows={3}
              maxLength={NO_NOTICE_REASON_MAX}
              className="w-full"
              required
            />
          ) : null}
          <SubmitButton variant="secondary" pendingLabel={pendingLabel}>
            {t("closeSubmit")}
          </SubmitButton>
        </form>
      ) : null}
    </section>
  );
}
