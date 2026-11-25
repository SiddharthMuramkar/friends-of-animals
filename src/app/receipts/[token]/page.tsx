import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ExplainState } from "@/components/site/explain-state";
import { Section } from "@/components/site/section";
import { RECEIPT_REQUEST } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { PrintButton } from "./_components/print-button";
import { ReceiptSheet } from "./_components/receipt-sheet";

// A donation's receipt behind its 7-day link (#106): never an attachment,
// rendered on request from the receipt's frozen snapshot, with the
// browser's print dialog for a PDF. An expired link offers a new one by
// email. Never cached, indexed or sent as a referrer
// (src/lib/security-headers.ts), and disallowed in robots.txt.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("receipts.meta");
  return { title: t("title"), robots: { index: false, follow: false } };
}

const HUE = ROUTES.donate.hue;

type Props = PageProps<"/receipts/[token]">;

export default async function Page({ params }: Props) {
  const t = await getTranslations("receipts");
  return (
    <Section hue={HUE} width="prose" className="pt-10 sm:pt-14 print:pt-0">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Receipt params={params} />
      </Suspense>
    </Section>
  );
}

async function Receipt({ params }: Pick<Props, "params">) {
  const [{ token }, t, format] = await Promise.all([
    params,
    getTranslations("receipts"),
    getFormatter(),
  ]);
  const found = await as(await currentActor()).getReceiptByToken({ token });
  if (!found.ok) {
    const state = found.error === "expired" ? "expired" : "notFound";
    return (
      <ExplainState
        title={t(`${state}.title`)}
        back={{ href: RECEIPT_REQUEST, label: t(`${state}.request`) }}
        headingLevel="h1"
      >
        <p>{t(`${state}.body`)}</p>
      </ExplainState>
    );
  }
  const { receipt } = found;
  return (
    <>
      <ReceiptSheet
        snapshot={receipt.snapshot}
        cancelled={receipt.cancelledAt !== null}
      />
      <div className="mt-6 flex flex-wrap items-center gap-4 print:hidden">
        <PrintButton label={t("sheet.print")} />
        <p className="text-ink-muted">
          {t("sheet.linkExpires", {
            date: format.dateTime(receipt.linkExpiresAt, {
              dateStyle: "long",
              timeStyle: "short",
            }),
          })}
        </p>
      </div>
    </>
  );
}
