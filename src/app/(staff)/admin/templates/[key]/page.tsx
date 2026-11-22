import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { messages } from "@/i18n/messages";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import {
  placeholderFor,
  renderTemplateWith,
} from "@/server/modules/notifications/preview";

import { Denied } from "../_components/denied";
import { lookupName, nameOr, type NameTree } from "../_lib/labels";
import { unlessRefused } from "../_lib/refusal";
import { TemplateForm } from "./_components/template-form";
import { secondStepRedirect } from "./_lib/form-state";
import { templateKeyOf } from "./_lib/template-key";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminTemplates.editor.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Params = PageProps<"/admin/templates/[key]">["params"];

export default async function Page({
  params,
}: PageProps<"/admin/templates/[key]">) {
  const t = await getTranslations("adminTemplates");
  return (
    <Section hue="teal" tone="tint" width="prose" className="pt-10 sm:pt-14">
      {/* The key and the template are request data: both stream in. */}
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Editor params={params} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

async function Editor({ params }: { params: Params }) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { key: raw } = await params;
  const key = templateKeyOf(raw);
  const [t, tc, format, result] = await Promise.all([
    getTranslations("adminTemplates"),
    getTranslations("common.callout"),
    getFormatter(),
    unlessRefused(() => as(actor).getMessageTemplate({ key })),
  ]);
  const back = { href: APP_ROUTES.adminTemplates, label: t("editor.back") };

  if (!result.ok) {
    // Staff short of their second step enter it, then come back (#60).
    const lift = secondStepRedirect(result.refusal, key);
    if (lift) redirect(lift);
  }
  if (!result.ok || !result.value.ok) {
    return (
      <>
        <PageHeader eyebrow={t("eyebrow")} tile="teal" title={t("title")} />
        {result.ok ? (
          <ExplainState
            title={t("editor.notFound")}
            back={back}
            className="mt-8"
          >
            {null}
          </ExplainState>
        ) : (
          <Denied className="mt-8" />
        )}
      </>
    );
  }

  const { template } = result.value;
  // en-IN is the only locale; these are looked up by data, not by key.
  const sampleValues: NameTree = messages.adminTemplates.editor.samples;
  const samples = (name: string) =>
    lookupName(sampleValues, name) ?? `[${name}]`;

  return (
    <>
      <PageHeader
        eyebrow={t("title")}
        tile="teal"
        title={nameOr(messages.adminTemplates.keys, template.key)}
        lead={t("editor.lead")}
      />
      <div className="mt-6">
        <ButtonLink href={back.href} variant="secondary">
          {back.label}
        </ButtonLink>
      </div>
      <div className="mt-10 flex flex-col gap-10">
        {template.channels.map((channel) => {
          const preview = renderTemplateWith(channel, samples);
          const headingId = `channel-${channel.channel}`;
          return (
            <section
              key={channel.channel}
              aria-labelledby={headingId}
              className={CARD}
            >
              <SectionHeading
                id={headingId}
                title={t(`channels.${channel.channel}`)}
              />
              <p className="mt-2 text-ink-muted">
                {channel.updatedBy
                  ? t("editor.changed", {
                      version: channel.version,
                      date: format.dateTime(channel.updatedAt, "longDateTime"),
                      name: channel.updatedBy.name,
                    })
                  : t("editor.original", { version: channel.version })}
              </p>
              <h3 className="mt-4 font-semibold text-ink">
                {t("editor.variables")}
              </h3>
              {channel.variables.length > 0 ? (
                <ul className="mt-1 flex flex-wrap gap-2">
                  {channel.variables.map((name) => (
                    <li
                      key={name}
                      className="rounded-full border border-border-strong px-3 py-1 font-mono text-sm text-ink"
                    >
                      {placeholderFor(name)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-ink-muted">{t("editor.noVariables")}</p>
              )}
              <div className="mt-6">
                <TemplateForm
                  templateKey={template.key}
                  channel={channel.channel}
                  initial={{
                    subject: channel.subject ?? "",
                    body: channel.body,
                    dltTemplateId: channel.dltTemplateId ?? "",
                    version: channel.version,
                  }}
                  labels={{
                    subject:
                      channel.channel === "sms"
                        ? null
                        : channel.channel === "email"
                          ? t("editor.subject")
                          : t("editor.title"),
                    body: t("editor.body"),
                    dlt: t("editor.dlt"),
                    dltHint: t("editor.dltHint"),
                    save: t("editor.save"),
                    saving: t("editor.saving"),
                    saved: t.raw("editor.saved") as string,
                    unchanged: t("editor.unchanged"),
                    stale: t("editor.stale"),
                    invalid: t("editor.invalid"),
                    problem: tc("danger"),
                    done: tc("success"),
                  }}
                />
              </div>
              <h3 className="mt-8 font-semibold text-ink">
                {t("editor.preview")}
              </h3>
              <p className="text-sm text-ink-muted">
                {t("editor.previewHint")}
              </p>
              <div className="mt-3 rounded-2xl border-2 border-dashed border-border-strong bg-surface-muted p-4">
                {preview.subject ? (
                  <p className="font-semibold text-ink wrap-anywhere">
                    {preview.subject}
                  </p>
                ) : null}
                <p className="mt-2 whitespace-pre-line text-ink wrap-anywhere">
                  {preview.body}
                </p>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
