import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { ADMIN_OFFLINE_DONATION } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { FormAlert } from "@/components/form";
import { adminCall } from "../../_lib/boundary";
import { DonationsDenied, DonationsFrame } from "../_components/frame";
import { OfflineDonationForm } from "./form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminDonations.offline");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function Page() {
  const [actor, t, common] = await Promise.all([
    currentActor(),
    getTranslations("adminDonations.offline"),
    getTranslations("common.callout"),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const access = await adminCall(
    () => as(actor).getOfflineDonationTerms(),
    ADMIN_OFFLINE_DONATION
  );
  if (!access.ok) return <DonationsDenied />;
  const { open, has80G, today } = access.value;
  return (
    <DonationsFrame title={t("title")} lead={t("lead")} back={t("back")}>
      {open ? (
        <OfflineDonationForm
          today={today}
          has80G={has80G}
          labels={{
            method: t("method"),
            methods: {
              cheque: t("methods.cheque"),
              bank_transfer: t("methods.bank_transfer"),
              cash: t("methods.cash"),
            },
            donorType: t("donorType"),
            types: {
              individual: t("types.individual"),
              corporate: t("types.corporate"),
              csr: t("types.csr"),
            },
            reference: t("reference"),
            referenceHint: t("referenceHint"),
            receivedOn: t("receivedOn"),
            amount: t("amount"),
            name: t("name"),
            email: t("email"),
            organisation: t("organisation"),
            pan: t("pan"),
            panHint: t("panHint"),
            proof: t("proof"),
            proofHint: t("proofHint"),
            declarations: t("declarations"),
            adult: t("adult"),
            indian: t("indian"),
            save: t("save"),
            saving: t("saving"),
            problem: common("danger"),
            errors: {
              failed: t("errors.failed"),
              invalid_input: t("errors.invalid_input"),
              proof_already_used: t("errors.proof_already_used"),
              proof_invalid: t("errors.proof_invalid"),
              upload_failed: t("errors.upload_failed"),
              donations_closed: t("errors.donations_closed"),
              declaration_required: t("errors.declaration_required"),
              type_not_allowed: t("errors.type_not_allowed"),
              too_large: t("errors.too_large"),
              empty: t("errors.empty"),
              reference: t("errors.reference"),
              receivedOn: t("errors.receivedOn"),
              amountMinor: t("errors.amountMinor"),
              name: t("errors.name"),
              email: t("errors.email"),
              organisationName: t("errors.organisationName"),
              pan: t("errors.pan"),
            },
          }}
        />
      ) : (
        <FormAlert tone="danger" label={common("danger")}>
          <p>{t("errors.donations_closed")}</p>
        </FormAlert>
      )}
    </DonationsFrame>
  );
}
