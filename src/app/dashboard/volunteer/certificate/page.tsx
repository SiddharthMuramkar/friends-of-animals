import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import {
  WorkFrame,
  WorkNotice,
  workCard,
} from "@/components/volunteers/work-ui";
import { SubmitButton } from "@/components/form";
import { ButtonLink } from "@/components/site/button-link";
import { MY_CERTIFICATES } from "@/lib/app-routes";
import { splitMinutes } from "@/server/modules/volunteers/domain/hours";
import { ownVolunteerRecord } from "../work-loader";
import { requestServiceCertificate } from "../work-actions";
export const instant = false;
export const metadata = {
  title: "Volunteer service certificate",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: PageProps<"/dashboard/volunteer/certificate">) {
  await connection();
  const [t, record, q] = await Promise.all([
    getTranslations("volunteerWork"),
    ownVolunteerRecord(),
    searchParams,
  ]);
  return (
    <WorkFrame title={t("myCertificate")} lead={t("certificateIntro")}>
      <WorkNotice result={q.result} />
      <div className={workCard}>
        <h2 className="text-h2">
          {t("approvedTotal", splitMinutes(record.approvedMinutes))}
        </h2>
        {record.approvedMinutes > 0 ? (
          <form action={requestServiceCertificate}>
            <SubmitButton pendingLabel={t("saving")}>
              {t("request")}
            </SubmitButton>
          </form>
        ) : (
          <p>{t("nothing_to_certify")}</p>
        )}
        <div>
          <ButtonLink href={MY_CERTIFICATES} variant="secondary">
            {t("viewCertificates")}
          </ButtonLink>
        </div>
      </div>
    </WorkFrame>
  );
}
