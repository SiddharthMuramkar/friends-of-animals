import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { SiteLink } from "@/components/site/site-link";
import { TextField } from "@/components/form/text-field";
import { SelectField } from "@/components/form/select-field";
import { FormAlert } from "@/components/form/form-alert";
import { ADMIN_OBJECTIVES, ADMIN_SOCIAL_METRICS } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { istDateOf } from "@/server/modules/ledger/domain/period";
import {
  MAX_METRIC,
  SOCIAL_CHANNELS,
  SOCIAL_METRICS,
} from "@/server/modules/reports/domain/social-snapshot";
import { AdminDenied } from "../../_components/admin-denied";
import { adminCall } from "../../_lib/boundary";
import {
  PeriodForm,
  periodFromQuery,
  periodUrl,
} from "../_components/period-form";
import { SocialTable } from "../_components/social-table";
import { recordSocialAction } from "./actions";

export async function generateMetadata() {
  const t = await getTranslations("objectiveReports");
  return { title: t("socialTitle"), robots: { index: false, follow: false } };
}

export default async function Page({
  searchParams,
}: PageProps<"/admin/reports/social">) {
  const [t, actor, query] = await Promise.all([
    getTranslations("objectiveReports"),
    currentActor(),
    searchParams,
  ]);
  const period = periodFromQuery(query);
  const loaded = await adminCall(
    () => as(actor).getSocialReport(period),
    ADMIN_SOCIAL_METRICS
  );
  const access =
    loaded.ok && actor.kind === "user" ? await as(actor).myAccess() : null;
  const editor = access?.grants.some(
    (g) =>
      g.scope.type === "global" &&
      ["content_manager", "super_admin"].includes(g.role)
  );
  const leader = access?.grants.some(
    (g) =>
      g.scope.type === "global" &&
      ["staff_admin", "super_admin"].includes(g.role)
  );
  const today = istDateOf(new Date());
  const done = query.done;
  const status =
    done === "recorded"
      ? "saved"
      : done === "corrected" || done === "unchanged"
        ? done
        : null;
  const error =
    done === "forbidden"
      ? "forbidden"
      : done === "invalidInput"
        ? "invalidInput"
        : null;
  return (
    <Section width="wide" className="pt-10 sm:pt-14">
      <PageHeader title={t("socialTitle")} lead={t("socialLead")} />
      {!loaded.ok ? (
        <AdminDenied />
      ) : (
        <>
          {leader ? (
            <SiteLink
              href={periodUrl(ADMIN_OBJECTIVES, period)}
              className="mt-4 inline-block"
            >
              {t("openObjectives")}
            </SiteLink>
          ) : null}
          {editor ? (
            <section
              className="mt-8 max-w-2xl rounded-3xl border-2 border-border bg-surface p-4 sm:p-6"
              aria-labelledby="record-social-title"
            >
              <h2 id="record-social-title">{t("recordTitle")}</h2>
              <p className="mt-3 text-ink-muted">{t("recordHint")}</p>
              {status ? (
                <FormAlert className="mt-4" tone="success" label={t(status)}>
                  {t(status)}
                </FormAlert>
              ) : null}
              {error ? (
                <FormAlert className="mt-4" tone="danger" label={t(error)}>
                  {t(error)}
                </FormAlert>
              ) : null}
              <form
                className="mt-6 space-y-4"
                action={recordSocialAction.bind(null, period)}
                aria-labelledby="record-social-title"
              >
                <SelectField
                  id="social-channel"
                  name="channel"
                  label={t("required", { label: t("channel") })}
                  options={SOCIAL_CHANNELS.map((channel) => ({
                    value: channel,
                    label: t(`channels.${channel}`),
                  }))}
                  placeholder={t("channelPlaceholder")}
                  required
                  defaultValue=""
                />
                <TextField
                  id="social-date"
                  name="recordedFor"
                  label={t("required", { label: t("recordedFor") })}
                  type="date"
                  max={today}
                  required
                  defaultValue={today}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  {SOCIAL_METRICS.map((field) => {
                    const required = field === "followers" || field === "posts";
                    return (
                      <TextField
                        id={`social-${field}`}
                        key={field}
                        name={field}
                        label={t(required ? "required" : "optional", {
                          label: t(`socialFields.${field}`),
                        })}
                        required={required}
                        type="number"
                        min={0}
                        max={MAX_METRIC}
                        step={1}
                      />
                    );
                  })}
                </div>
                <button type="submit" className={buttonStyles()}>
                  {t("record")}
                </button>
              </form>
            </section>
          ) : null}
          <PeriodForm path={ADMIN_SOCIAL_METRICS} period={period} />
          {!loaded.value.ok ? (
            <p className="mt-4 font-semibold text-danger" role="alert">
              {t("invalidPeriod")}
            </p>
          ) : (
            <>
              <p className="mt-4 font-semibold">{t("range", period)}</p>
              <ButtonLink
                href={periodUrl(`${ADMIN_SOCIAL_METRICS}/export.csv`, period)}
                className="mt-4"
                prefetch={false}
              >
                {t("download")}
              </ButtonLink>
              <p className="mt-2 text-ink-muted">{t("socialDownloadHint")}</p>
              <SocialTable snapshots={loaded.value.report.snapshots} />
            </>
          )}
        </>
      )}
    </Section>
  );
}
