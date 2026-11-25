import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import {
  WorkFrame,
  WorkNotice,
  workCard,
} from "@/components/volunteers/work-ui";
import { SubmitButton, inputStyles } from "@/components/form";
import { ADMIN_VOLUNTEER_HOURS } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { splitMinutes } from "@/server/modules/volunteers/domain/hours";
import { adminCall } from "../../_lib/boundary";
import { AdminDenied } from "../../_components/admin-denied";
import { decideHours, correctCertificate } from "../work-actions";
export const instant = false;
export const metadata = {
  title: "Review volunteer hours and certificates",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: PageProps<"/admin/volunteers/hours">) {
  await connection();
  const api = as(await currentActor());
  const [t, c, q, loaded] = await Promise.all([
    getTranslations("volunteerWork"),
    getTranslations("certificates"),
    searchParams,
    adminCall(
      async () => ({
        hours: await api.listVolunteerHours(),
        certificates: await api.listVolunteerCertificates(),
      }),
      ADMIN_VOLUNTEER_HOURS
    ),
  ]);
  if (!loaded.ok) return <AdminDenied />;
  return (
    <WorkFrame title={t("hoursReview")} staff>
      <WorkNotice result={q.result} />
      <section className="grid gap-4">
        <h2 className="text-h2">{t("hours")}</h2>
        {loaded.value.hours.length === 0 ? (
          <p>{t("none")}</p>
        ) : (
          <ul className="grid gap-4">
            {loaded.value.hours.map((entry) => (
              <li key={entry.id} className={workCard}>
                <h3 className="text-h3">
                  {entry.volunteerName} · {entry.taskTitle}
                </h3>
                <p>
                  <time dateTime={entry.workedOn}>{entry.workedOn}</time> ·{" "}
                  {t("duration", splitMinutes(entry.minutes))} ·{" "}
                  {t(`hourStates.${entry.status}`)}
                </p>
                {entry.note && <p>{entry.note}</p>}
                {entry.rejectReason && (
                  <p>
                    {t("reason")}: {entry.rejectReason}
                  </p>
                )}
                {entry.status === "submitted" && (
                  <div className="grid gap-4">
                    <form action={decideHours.bind(null, entry.id, "approve")}>
                      <SubmitButton pendingLabel={t("saving")}>
                        {t("approve")}
                        <span className="sr-only"> {entry.taskTitle}</span>
                      </SubmitButton>
                    </form>
                    <form
                      action={decideHours.bind(null, entry.id, "reject")}
                      className="grid gap-3"
                      aria-label={`${t("reject")} ${entry.taskTitle}`}
                    >
                      <label
                        htmlFor={`reason-${entry.id}`}
                        className="font-semibold grid gap-2"
                      >
                        {t("reason")}
                        <textarea
                          required
                          maxLength={500}
                          id={`reason-${entry.id}`}
                          name="reason"
                          className={inputStyles}
                        />
                      </label>
                      <div>
                        <SubmitButton
                          pendingLabel={t("saving")}
                          variant="secondary"
                        >
                          {t("reject")}
                          <span className="sr-only"> {entry.taskTitle}</span>
                        </SubmitButton>
                      </div>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid gap-4">
        <h2 className="text-h2">{t("certificates")}</h2>
        {loaded.value.certificates.length === 0 ? (
          <p>{t("none")}</p>
        ) : (
          <ul className="grid gap-4">
            {loaded.value.certificates.map((cert) => (
              <li className={workCard} key={cert.id}>
                <h3 className="text-h3">{cert.recipientName}</h3>
                <p className="break-words">
                  {cert.number} · {c(`status.${cert.status}`)} ·{" "}
                  {c(`renderStatus.${cert.renderStatus}`)}
                </p>
                <p>{t("approvedTotal", splitMinutes(cert.approvedMinutes!))}</p>
                {cert.status === "issued" && (
                  <>
                    <p>{c("correctionHelp")}</p>
                    {cert.renderStatus === "failed" && (
                      <form
                        action={correctCertificate.bind(null, cert.id, "retry")}
                      >
                        <SubmitButton pendingLabel={t("saving")}>
                          {c("retry")}
                        </SubmitButton>
                      </form>
                    )}
                    <form
                      action={correctCertificate.bind(null, cert.id, "revoke")}
                      className="grid gap-3"
                      aria-label={`${c("revoke")} ${cert.number}`}
                    >
                      <label
                        htmlFor={`revoke-${cert.id}`}
                        className="grid gap-2 font-semibold"
                      >
                        {c("reason")}
                        <textarea
                          required
                          maxLength={1000}
                          id={`revoke-${cert.id}`}
                          name="reason"
                          className={inputStyles}
                        />
                      </label>
                      <div>
                        <SubmitButton
                          pendingLabel={t("saving")}
                          variant="secondary"
                        >
                          {c("revoke")}
                        </SubmitButton>
                      </div>
                    </form>
                    <form
                      action={correctCertificate.bind(null, cert.id, "reissue")}
                      className="grid gap-3"
                      aria-label={`${c("reissue")} ${cert.number}`}
                    >
                      <label
                        htmlFor={`name-${cert.id}`}
                        className="grid gap-2 font-semibold"
                      >
                        {c("correctName")}
                        <input
                          required
                          maxLength={150}
                          id={`name-${cert.id}`}
                          name="recipientName"
                          defaultValue={cert.recipientName}
                          className={inputStyles}
                        />
                      </label>
                      <label
                        htmlFor={`reissue-${cert.id}`}
                        className="grid gap-2 font-semibold"
                      >
                        {c("reason")}
                        <textarea
                          required
                          maxLength={1000}
                          id={`reissue-${cert.id}`}
                          name="reason"
                          className={inputStyles}
                        />
                      </label>
                      <div>
                        <SubmitButton
                          pendingLabel={t("saving")}
                          variant="secondary"
                        >
                          {c("reissue")}
                        </SubmitButton>
                      </div>
                    </form>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </WorkFrame>
  );
}
