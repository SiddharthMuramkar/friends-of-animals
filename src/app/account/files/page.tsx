import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ROUTES } from "@/lib/routes";
import { appEnv } from "@/lib/site";
import { currentActor } from "@/server/app";
import { PURPOSE_RULES } from "@/server/modules/files/domain/purposes";

import { UploadForm } from "./_components/upload-form";
import { typeNameKeys } from "./_lib/upload";

// The file upload demo (#63): a signed-in user uploads one file straight
// to private storage and fetches it back once the virus check passes. It
// is the Seam 2 round trip for the Files module, so it exists everywhere
// but production (src/proxy.ts answers 404 there).

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("files.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  const t = await getTranslations("files");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      {/* The session is read per request, so the form streams in behind
          this boundary while the heading above is prerendered. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Upload />
      </Suspense>
    </Section>
  );
}

const MiB = 1024 * 1024;

async function Upload() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  // The proxy already answers 404 in production; this is the backstop.
  if (appEnv() === "production") notFound();

  const [t, callout, format] = await Promise.all([
    getTranslations("files"),
    getTranslations("common.callout"),
    getFormatter(),
  ]);
  const rule = PURPOSE_RULES.test_upload;
  const maxMb = rule.maxBytes / MiB;
  const types = typeNameKeys(rule.contentTypes).map((key) => t(`types.${key}`));
  const anyOf = format.list(types, { type: "disjunction" });

  return (
    <div className="mt-8 flex flex-col gap-6">
      <p className="text-ink-muted">{t("testOnly")}</p>
      <UploadForm
        accept={rule.contentTypes.join(",")}
        labels={{
          field: {
            label: t("field.label"),
            hint: t("field.hint", { types: anyOf, maxMb }),
          },
          upload: t("upload"),
          uploading: t("uploading"),
          status: {
            uploading: t("status.uploading"),
            checking: t("status.checking"),
            ready: t("status.ready"),
            readyLead: t("status.readyLead"),
            slow: t("status.slow"),
          },
          downloadFile: t("downloadFile"),
          problem: callout("danger"),
          errors: {
            noFile: t("errors.noFile"),
            signedOut: t("errors.signedOut"),
            tooLarge: t("errors.tooLarge", { maxMb }),
            empty: t("errors.empty"),
            typeNotAllowed: t("errors.typeNotAllowed", { types: anyOf }),
            switchedOff: t("errors.switchedOff"),
            uploadFailed: t("errors.uploadFailed"),
            uploadRejected: t("errors.uploadRejected"),
            blocked: t("errors.blocked"),
            unknown: t("errors.unknown"),
          },
        }}
      />
    </div>
  );
}
