import { TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import type { SettingView } from "@/server/modules/settings";

import {
  SettingForm,
  type SettingFormLabels,
} from "./_components/setting-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSettings.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  const t = await getTranslations("adminSettings");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      {/* Settings are read per request, uncached, so a change shows at
          once. The staff layout waits for the request, so the whole page
          renders at request time: the heading streams first, and the
          settings follow behind this boundary. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Settings />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

/** Why a refused actor sees no settings, in words from adminSettings. */
async function Refused({ code }: { code: DomainError["code"] }) {
  const t = await getTranslations("adminSettings");
  return (
    <ExplainState
      title={t("denied.title")}
      back={{ href: APP_ROUTES.accountSessions, label: t("denied.back") }}
      className="mt-8"
    >
      <p>{code === "forbidden" ? t("denied.body") : t(`errors.${code}`)}</p>
    </ExplainState>
  );
}

async function Settings() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  let settings: SettingView[];
  try {
    settings = await as(actor).listSettings();
  } catch (error) {
    // listSettings refuses anyone but a super admin, and staff without
    // this session's second factor (#60). A page never calls forbidden():
    // authInterrupts is off.
    if (error instanceof DomainError) return <Refused code={error.code} />;
    throw error;
  }
  const [t, format] = await Promise.all([
    getTranslations("adminSettings"),
    getFormatter(),
  ]);

  const shown = (setting: SettingView, value: boolean | number | string) => {
    switch (setting.input.kind) {
      case "boolean":
        return t(value ? "values.on" : "values.off");
      case "integer":
        return t("values.amount", {
          unit: setting.input.unit,
          count: Number(value),
        });
      case "text":
        return value === "" ? t("values.notSet") : String(value);
    }
  };

  const lastChange = (setting: SettingView) => {
    if (!setting.updatedAt) return t("facts.usingDefault");
    const date = format.dateTime(setting.updatedAt, "longDateTime");
    return setting.updatedBy
      ? t("facts.changedBy", { name: setting.updatedBy.name, date })
      : t("facts.changedOn", { date });
  };

  const labelsFor = (setting: SettingView): SettingFormLabels => ({
    newValue:
      setting.input.kind === "integer"
        ? t("form.newAmount", { unit: setting.input.unit })
        : t("form.newValue"),
    range:
      setting.input.kind === "integer"
        ? t("form.range", { min: setting.input.min, max: setting.input.max })
        : setting.input.kind === "text"
          ? t("form.length", { maxLength: setting.input.maxLength })
          : undefined,
    on: t("values.on"),
    off: t("values.off"),
    save: t("form.save"),
    saving: t("form.saving"),
    done: t("result.done"),
    problem: t("result.problem"),
  });

  return (
    <section aria-labelledby="settings-list" className="mt-10">
      <SectionHeading id="settings-list" title={t("listTitle")} />
      <ul className="mt-5 flex flex-col gap-5">
        {settings.map((setting) => {
          // Every id in this setting's card starts with this, the
          // heading's and the form's alike, so none can clash.
          const idPrefix = `setting-${setting.key.replace(/\W/g, "-")}`;
          const headingId = `${idPrefix}-title`;
          return (
            <li key={setting.key}>
              <article aria-labelledby={headingId} className={CARD}>
                <h3
                  id={headingId}
                  className="font-display text-h4 leading-tight text-ink"
                >
                  {t(`settings.${setting.key}.label`)}
                </h3>
                <p className="mt-2 text-ink-muted">
                  {t(`settings.${setting.key}.description`)}
                </p>
                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="font-semibold text-ink">{t("facts.now")}</dt>
                  <dd className="text-ink">{shown(setting, setting.value)}</dd>
                  <dt className="font-semibold text-ink">
                    {t("facts.default")}
                  </dt>
                  <dd className="text-ink">
                    {shown(setting, setting.defaultValue)}
                  </dd>
                  <dt className="font-semibold text-ink">
                    {t("facts.lastChange")}
                  </dt>
                  <dd className="text-ink-muted wrap-anywhere">
                    {lastChange(setting)}
                  </dd>
                </dl>
                {setting.storedInvalid ? (
                  <p className="mt-4 flex items-start gap-2 rounded-2xl border-2 border-warning-border bg-warning-bg p-3 text-ink">
                    <TriangleAlert
                      aria-hidden="true"
                      className="mt-0.5 size-5 shrink-0"
                    />
                    <span>{t("storedInvalid")}</span>
                  </p>
                ) : null}
                <div className="mt-5">
                  <SettingForm
                    idPrefix={idPrefix}
                    settingKey={setting.key}
                    input={setting.input}
                    value={setting.value}
                    labels={labelsFor(setting)}
                  />
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
